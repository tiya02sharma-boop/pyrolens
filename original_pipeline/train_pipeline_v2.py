"""
AI-Based Detection & Classification of Industrial Fires and Persistent Thermal Sources
=========================================================================================
VERSION 2 — now includes Sentinel-2 satellite spectral features (NDVI, NBR, NDBI + raw bands)
on top of the original FIRMS + persistence + OSM-distance features.

Run from VS Code: `python train_pipeline_v2.py`
Expects firms_india_50k_satellite.csv and firms_us_50k_satellite.csv in the same folder.
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import LabelEncoder
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.utils.class_weight import compute_sample_weight
import xgboost as xgb
import matplotlib.pyplot as plt
import seaborn as sns
import joblib

RANDOM_STATE = 42
np.random.seed(RANDOM_STATE)

# ---------------------------------------------------------------------------
# 1. LOAD & COMBINE
# ---------------------------------------------------------------------------
print("=" * 70)
print("STEP 1: Loading data")
print("=" * 70)

india = pd.read_csv("firms_india_50k_FINAL_with_sentinel2.csv.xls")
us = pd.read_csv("firms_us_50k_merged_satellite.csv.xls")
us["country"] = "US"
india["country"] = "India"

df = pd.concat([us, india], ignore_index=True)
print(f"Combined shape: {df.shape}")
print(df["category"].value_counts())

unlabeled = df[df["category"] == "unlabeled"].copy()
df = df[df["category"] != "unlabeled"].copy()
print(f"\nDropped {len(unlabeled)} 'unlabeled' rows from training (kept for later inference)")
print(f"Training pool: {len(df)} rows across {df['category'].nunique()} classes")

# ---------------------------------------------------------------------------
# 2. SATELLITE (SENTINEL-2) FEATURE HANDLING — NEW IN V2
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("STEP 2: Satellite feature processing")
print("=" * 70)

SAT_BANDS = ["blue", "green", "red", "nir", "swir1", "swir2"]
SAT_INDICES = ["ndvi", "ndbi", "nbr"]
SAT_COLS = SAT_BANDS + SAT_INDICES

# Some rows have NO satellite match at all (cloud cover, no clear Sentinel-2 pass
# near the detection date) — this is a REAL, documented Sentinel-2 limitation, not
# a bug. We flag it as its own feature rather than silently imputing a fake value,
# since "no clear satellite image available" can itself carry information (e.g.
# persistent smoke/haze at industrial sites).
df["satellite_data_available"] = df[SAT_COLS].notna().all(axis=1).astype(int)
missing_sat = (df["satellite_data_available"] == 0).sum()
print(f"Rows with no usable satellite match: {missing_sat} ({missing_sat/len(df)*100:.2f}%)")

# Impute missing satellite values with the median WITHIN the same region, so a
# cloud-covered Texas point doesn't get imputed with an India-wide median.
for col in SAT_COLS:
    df[col] = df.groupby("region")[col].transform(lambda s: s.fillna(s.median()))
    df[col] = df[col].fillna(df[col].median())  # fallback for any region with all-NaN

# A few extra engineered features directly from the WUI/fire-type literature we
# discussed: vegetation presence is a strong wildfire-vs-everything-else signal,
# and a low-vegetation + high-built-up combination is a strong industrial signal.
df["is_vegetated"] = (df["ndvi"] > 0.3).astype(int)          # rough forest/crop threshold
df["is_built_up"] = (df["ndbi"] > 0.0).astype(int)           # positive NDBI = built/bare surface
df["burn_signal"] = (df["nbr"] < -0.1).astype(int)           # NBR drop = likely burn scar
print("Added: satellite_data_available, is_vegetated, is_built_up, burn_signal")

# ---------------------------------------------------------------------------
# 3. STANDARD FEATURE ENGINEERING (same as v1)
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("STEP 3: Standard feature engineering")
print("=" * 70)

df["acq_date"] = pd.to_datetime(df["acq_date"])
df["month"] = df["acq_date"].dt.month
df["day_of_year"] = df["acq_date"].dt.dayofyear
df["hour"] = (df["acq_time"] // 100).astype(int)

for col in ["dist_to_industrial_km", "dist_to_farmland_km", "dist_to_mining_km"]:
    if col in df.columns:
        df[col] = df[col].fillna(df[col].max() if df[col].notna().any() else 999)

df["industrial_polygon_type"] = df["industrial_polygon_type"].fillna("none")
df["land_cover_class"] = df["land_cover_class"].fillna("unknown")

cat_cols = ["confidence", "daynight", "satellite", "instrument",
            "land_cover_class", "industrial_polygon_type"]
encoders = {}
for c in cat_cols:
    le = LabelEncoder()
    df[c + "_enc"] = le.fit_transform(df[c].astype(str))
    encoders[c] = le

# Final feature list — original FIRMS/persistence/OSM features PLUS the new
# satellite bands, indices, and derived vegetation/built-up/burn flags.
# 'region' and 'country' stay excluded from the model input (geography leak risk).
FEATURES = [
    "bright_ti4", "bright_ti5", "frp", "scan", "track",
    "brightness_temp_diff", "frp_to_temp_ratio", "footprint_proxy",
    "temp_percentile_in_region",
    "persistence_count_7d", "persistence_count_30d",
    "persistence_count_90d", "persistence_count_365d",
    "location_night_fraction",
    "dist_to_industrial_km", "dist_to_farmland_km", "dist_to_mining_km",
    "month", "day_of_year", "hour",
    "confidence_enc", "daynight_enc", "satellite_enc", "instrument_enc",
    "land_cover_class_enc", "industrial_polygon_type_enc",
    # --- new satellite features ---
    "blue", "green", "red", "nir", "swir1", "swir2",
    "ndvi", "ndbi", "nbr",
    "satellite_data_available", "is_vegetated", "is_built_up", "burn_signal",
]
FEATURES = [f for f in FEATURES if f in df.columns]
print(f"Using {len(FEATURES)} features (was 26 in v1, now includes satellite bands/indices)")

X = df[FEATURES].copy()
y = df["category"].copy()

label_encoder = LabelEncoder()
y_enc = label_encoder.fit_transform(y)
print(f"Classes: {list(label_encoder.classes_)}")

# ---------------------------------------------------------------------------
# 4. LEAKAGE-SAFE SPATIAL-BLOCK SPLIT
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("STEP 4: Spatial-block train/test split (80/20, grouped by grid_cell_id)")
print("=" * 70)

splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=RANDOM_STATE)
train_idx, test_idx = next(splitter.split(X, y_enc, groups=df["grid_cell_id"]))

X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
y_train, y_test = y_enc[train_idx], y_enc[test_idx]

print(f"Train: {len(X_train)} rows | Test: {len(X_test)} rows")
print("Test size used: 20% (test_size=0.2)")
print("No grid-cell overlap between train/test:",
      len(set(df.iloc[train_idx]["grid_cell_id"]) & set(df.iloc[test_idx]["grid_cell_id"])) == 0)

sample_weights = compute_sample_weight(class_weight="balanced", y=y_train)

# ---------------------------------------------------------------------------
# 5. TRAIN XGBOOST
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("STEP 5: Training XGBoost")
print("=" * 70)

xgb_model = xgb.XGBClassifier(
    n_estimators=300,
    max_depth=6,
    learning_rate=0.08,
    subsample=0.8,
    colsample_bytree=0.8,
    objective="multi:softprob",
    num_class=len(label_encoder.classes_),
    eval_metric="mlogloss",
    random_state=RANDOM_STATE,
    n_jobs=-1,
)
xgb_model.fit(X_train, y_train, sample_weight=sample_weights)

xgb_train_pred = xgb_model.predict(X_train)
xgb_pred = xgb_model.predict(X_test)

print("\n--- XGBoost TEST classification report ---")
print(classification_report(y_test, xgb_pred, target_names=label_encoder.classes_))

xgb_train_acc = (xgb_train_pred == y_train).mean()
xgb_test_acc = (xgb_pred == y_test).mean()
xgb_train_f1 = f1_score(y_train, xgb_train_pred, average="macro")
xgb_test_f1 = f1_score(y_test, xgb_pred, average="macro")

print(f"XGBoost TRAIN accuracy: {xgb_train_acc:.4f}  | TRAIN macro F1: {xgb_train_f1:.4f}")
print(f"XGBoost TEST accuracy:  {xgb_test_acc:.4f}  | TEST macro F1:  {xgb_test_f1:.4f}")
print(f"Accuracy gap (train - test): {xgb_train_acc - xgb_test_acc:.4f}")

# ---------------------------------------------------------------------------
# 6. TRAIN RANDOM FOREST
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("STEP 6: Training Random Forest (baseline comparison)")
print("=" * 70)

rf_model = RandomForestClassifier(
    n_estimators=400,
    max_depth=14,
    class_weight="balanced",
    random_state=RANDOM_STATE,
    n_jobs=-1,
)
rf_model.fit(X_train, y_train)

rf_train_pred = rf_model.predict(X_train)
rf_pred = rf_model.predict(X_test)

print("\n--- Random Forest TEST classification report ---")
print(classification_report(y_test, rf_pred, target_names=label_encoder.classes_))

rf_train_acc = (rf_train_pred == y_train).mean()
rf_test_acc = (rf_pred == y_test).mean()
rf_train_f1 = f1_score(y_train, rf_train_pred, average="macro")
rf_test_f1 = f1_score(y_test, rf_pred, average="macro")

print(f"Random Forest TRAIN accuracy: {rf_train_acc:.4f}  | TRAIN macro F1: {rf_train_f1:.4f}")
print(f"Random Forest TEST accuracy:  {rf_test_acc:.4f}  | TEST macro F1:  {rf_test_f1:.4f}")
print(f"Accuracy gap (train - test): {rf_train_acc - rf_test_acc:.4f}")

# ---------------------------------------------------------------------------
# 7. FEATURE IMPORTANCE
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("STEP 7: Feature importance (XGBoost) — check whether satellite features help")
print("=" * 70)

importances = pd.Series(xgb_model.feature_importances_, index=FEATURES).sort_values(ascending=False)
print(importances.head(20))

plt.figure(figsize=(8, 7))
importances.head(20).sort_values().plot(kind="barh")
plt.title("Top 20 feature importances (XGBoost, v2 with satellite features)")
plt.tight_layout()
plt.savefig("feature_importance_v2.png", dpi=150)
print("Saved feature_importance_v2.png")

plt.figure(figsize=(8, 7))
cm = confusion_matrix(y_test, xgb_pred)
sns.heatmap(cm, annot=True, fmt="d", cmap="Blues",
            xticklabels=label_encoder.classes_, yticklabels=label_encoder.classes_)
plt.xlabel("Predicted")
plt.ylabel("Actual")
plt.title("XGBoost confusion matrix (v2, spatial-block test set)")
plt.tight_layout()
plt.savefig("confusion_matrix_v2.png", dpi=150)
print("Saved confusion_matrix_v2.png")

# ---------------------------------------------------------------------------
# 8. PERSISTENCE / ANOMALY LAYER
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("STEP 8: Persistence-anomaly layer (Isolation Forest)")
print("=" * 70)

anomaly_features = ["bright_ti4", "frp", "persistence_count_30d", "frp_to_temp_ratio", "ndvi", "nbr"]
iso_model = IsolationForest(n_estimators=200, contamination=0.05, random_state=RANDOM_STATE)
df["anomaly_score"] = iso_model.fit_predict(df[anomaly_features])
df["is_anomalous"] = df["anomaly_score"] == -1

print(f"Flagged {df['is_anomalous'].sum()} rows ({df['is_anomalous'].mean()*100:.1f}%) as anomalous")
print(df.groupby("category")["is_anomalous"].mean().sort_values(ascending=False))

# ---------------------------------------------------------------------------
# 9. SAVE EVERYTHING
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("STEP 9: Saving models and artifacts")
print("=" * 70)

joblib.dump(xgb_model, "model_xgboost_v2.joblib")
joblib.dump(rf_model, "model_random_forest_v2.joblib")
joblib.dump(iso_model, "model_isolation_forest_v2.joblib")
joblib.dump(label_encoder, "label_encoder_v2.joblib")
joblib.dump(encoders, "categorical_encoders_v2.joblib")
joblib.dump(FEATURES, "feature_list_v2.joblib")

df.to_csv("firms_combined_with_predictions_v2.csv", index=False)

print("Saved all v2 models + firms_combined_with_predictions_v2.csv")
print("\nCompare v2's macro F1 against your earlier v1 result (0.8987 XGBoost) to see")
print("whether the Sentinel-2 satellite features actually improved the model — this")
print("comparison itself is worth a slide: did the extra data help, and by how much.")
