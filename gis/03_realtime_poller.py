"""AGNI real-time ingestion poller.

Pulls new NASA FIRMS NRT detections for monitored regions, classifies each
one with the dashboard model, then inserts the results into PostGIS.

Run on a schedule matching FIRMS' update cadence:

    python3 gis/03_realtime_poller.py

Requires ``FIRMS_MAP_KEY`` (from NASA FIRMS) and ``DATABASE_URL``.
"""
from __future__ import annotations

import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sqlalchemy import create_engine, text

ROOT = Path(__file__).parent.parent
MODEL_DIR = ROOT / "models"
REFERENCE_CSV = ROOT / "outputs" / "firms_combined_with_predictions_v2.csv"

MAP_KEY = os.environ["FIRMS_MAP_KEY"]
DB_URL = os.environ["DATABASE_URL"]
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql+psycopg2://", 1)

# Bounding boxes are west, south, east, north.
REGIONS = {
    "punjab_haryana": (74.0, 29.0, 77.5, 32.5),
    "jharia_raniganj": (86.0, 23.5, 87.5, 24.0),
    "jamnagar": (69.5, 22.0, 70.5, 22.7),
    "delhi_ncr": (76.8, 28.3, 77.6, 28.9),
    "california_pnw": (-124.5, 32.5, -116.0, 49.0),
    "texas_louisiana_gulf": (-97.5, 27.5, -89.0, 31.0),
    "palouse_midwest": (-118.0, 46.0, -116.5, 47.5),
}
DAY_RANGE = 1

UI_CATEGORY = {"offshore_flare_or_platform": "flare"}


def fetch_new_detections() -> pd.DataFrame:
    """Pull the latest NRT VIIRS detections for every monitored region."""
    frames = []
    for region, (west, south, east, north) in REGIONS.items():
        url = (
            f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
            f"{MAP_KEY}/VIIRS_NOAA20_NRT/{west},{south},{east},{north}/{DAY_RANGE}"
        )
        try:
            df = pd.read_csv(url)
        except Exception as error:
            print(f"  [warn] fetch failed for {region}: {error}")
            continue
        if df.empty:
            continue
        df["region"] = region
        frames.append(df)
        print(f"  {region}: {len(df)} raw detections pulled")
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def drop_already_seen(engine, new_df: pd.DataFrame) -> pd.DataFrame:
    """Dedupe against stored location and acquisition-date pairs."""
    if new_df.empty:
        return new_df
    with engine.connect() as conn:
        existing = pd.read_sql(
            text("SELECT latitude, longitude, acq_date FROM detections"), conn
        )
    if existing.empty:
        return new_df
    merged = new_df.merge(
        existing, on=["latitude", "longitude", "acq_date"], how="left", indicator=True
    )
    return new_df[merged["_merge"].values == "left_only"].copy()


def classify_batch(df: pd.DataFrame) -> pd.DataFrame:
    """Classify new detections using their nearest enriched reference row."""
    reference = pd.read_csv(REFERENCE_CSV)
    model = joblib.load(MODEL_DIR / "model_xgboost_v2.joblib")
    label_encoder = joblib.load(MODEL_DIR / "label_encoder_v2.joblib")
    features = joblib.load(MODEL_DIR / "feature_list_v2.joblib")

    results = []
    for _, point in df.iterrows():
        distance = (
            (reference.latitude - point.latitude) ** 2
            + ((reference.longitude - point.longitude) * np.cos(np.radians(point.latitude))) ** 2
        )
        ref_row = reference.loc[distance.idxmin()].copy()
        ref_row["frp"] = point.get("frp", ref_row["frp"])
        ref_row["bright_ti4"] = point.get("bright_ti4", ref_row["bright_ti4"])
        ref_row["bright_ti5"] = point.get("bright_ti5", ref_row["bright_ti5"])
        ref_row["frp_to_temp_ratio"] = ref_row["frp"] / max(float(ref_row["bright_ti4"]), 1)
        ref_row["footprint_proxy"] = float(ref_row.get("scan", 1)) * float(ref_row.get("track", 1))

        probabilities = model.predict_proba(pd.DataFrame([ref_row[features]]))[0]
        raw_scores = dict(zip(label_encoder.classes_, probabilities, strict=True))
        scores = {key: 0.0 for key in ("industrial", "flare", "agricultural", "wildfire", "mining")}
        for key, value in raw_scores.items():
            scores[UI_CATEGORY.get(str(key), str(key))] += float(value)
        category = max(scores, key=scores.get)
        results.append({
            "region": point["region"], "acq_date": point["acq_date"],
            "latitude": point.latitude, "longitude": point.longitude,
            "frp": float(point.get("frp", 0)),
            "bright_ti4": float(point.get("bright_ti4", 0)),
            "bright_ti5": float(point.get("bright_ti5", 0)),
            "daynight": point.get("daynight", "D"), "category": category,
            "confidence": scores[category], "persistence_30d": None,
            "is_anomalous": False, "anomaly_score": None,
        })
    return pd.DataFrame(results)


def insert_new_rows(engine, df: pd.DataFrame) -> None:
    if df.empty:
        print("Nothing new to insert.")
        return
    insert_sql = text("""
        INSERT INTO detections
            (region, acq_date, latitude, longitude, frp, bright_ti4, bright_ti5,
             daynight, category, confidence, persistence_30d, is_anomalous,
             anomaly_score, geom)
        VALUES
            (:region, :acq_date, :latitude, :longitude, :frp, :bright_ti4, :bright_ti5,
             :daynight, :category, :confidence, :persistence_30d, :is_anomalous,
             :anomaly_score, ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326))
    """)
    with engine.begin() as conn:
        conn.execute(insert_sql, df.to_dict(orient="records"))
    print(f"Inserted {len(df)} new classified detections.")


def main() -> None:
    engine = create_engine(DB_URL)
    print("Fetching latest FIRMS NRT detections...")
    raw = fetch_new_detections()
    print(f"Total raw detections pulled: {len(raw)}")
    new = drop_already_seen(engine, raw)
    print(f"New (not already stored): {len(new)}")
    if not new.empty:
        insert_new_rows(engine, classify_batch(new))


if __name__ == "__main__":
    main()
