"""AGNI API and production host for the Pyrolens dashboard.

v3: when DATABASE_URL is configured, /api/detections,
/api/detections/nearby, and /api/regions/summary query PostGIS directly.
Without it, the same endpoints safely use the verified CSV output. /api/classify still uses
the CSV-backed `assets()` for its nearest-historic-point feature lookup,
since the ML model needs the full enriched feature row (land cover, OSM
distance, spectral indices, etc.) that isn't duplicated in the lighter
`detections` table -- that table exists specifically to serve the map/API
fast, not to be the ML feature store.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Annotated

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
try:
    from sqlalchemy import create_engine, text
except ImportError:  # The map can still run from its CSV data without PostGIS.
    create_engine = text = None

ROOT = Path(__file__).parent
MODEL_DIR = ROOT / "models"
PREDICTIONS_PATH = ROOT / "outputs" / "firms_combined_with_predictions_v2.csv"
# Optional: set DATABASE_URL to enable the PostGIS-backed map API. Keeping
# this unset makes a fresh clone immediately usable with the verified CSV.
DB_URL = os.getenv("DATABASE_URL")
engine = create_engine(DB_URL, pool_pre_ping=True) if DB_URL and create_engine else None

UI_CATEGORY = {"offshore_flare_or_platform": "flare"}
REGION_LABELS = {
    "punjab_haryana": "Punjab / Haryana, IN", "jharia_raniganj": "Jharia / Raniganj Coalfield, IN",
    "jamnagar": "Jamnagar, Gujarat, IN", "delhi_ncr": "Delhi / NCR, IN",
    "california_pnw": "California / Pacific NW, US", "texas_louisiana_gulf": "Texas / Louisiana Gulf Coast, US",
    "palouse_midwest": "Palouse (WA) / Midwest, US",
}
REGION_IDS = {
    "punjab_haryana": "punjab-haryana", "jharia_raniganj": "jharia-raniganj",
    "jamnagar": "jamnagar", "delhi_ncr": "delhi-ncr", "california_pnw": "california-pnw",
    "texas_louisiana_gulf": "gulf-coast", "palouse_midwest": "palouse",
}
FEATURE_LABELS = {
    "bright_ti4": "I4 brightness temperature",
    "bright_ti5": "I5 brightness temperature",
    "frp": "Fire radiative power (FRP)",
    "scan": "Scan pixel size",
    "track": "Track pixel size",
    "brightness_temp_diff": "I4–I5 temperature difference",
    "frp_to_temp_ratio": "FRP-to-brightness ratio",
    "footprint_proxy": "Pixel footprint",
    "temp_percentile_in_region": "Regional temperature percentile",
    "persistence_count_7d": "Detections in the last 7 days",
    "persistence_count_30d": "Detections in the last 30 days",
    "persistence_count_90d": "Detections in the last 90 days",
    "persistence_count_365d": "Detections in the last year",
    "location_night_fraction": "Night-time detection fraction",
    "dist_to_industrial_km": "Distance to industrial sites",
    "dist_to_farmland_km": "Distance to farmland",
    "dist_to_mining_km": "Distance to mining sites",
    "month": "Month of year",
    "day_of_year": "Day of year",
    "hour": "Hour of acquisition",
    "confidence_enc": "FIRMS confidence flag",
    "daynight_enc": "Day/night flag",
    "satellite_enc": "Satellite",
    "instrument_enc": "Instrument",
    "land_cover_class_enc": "Land cover",
    "industrial_polygon_type_enc": "Nearby industrial polygon",
    "blue": "Sentinel-2 blue band",
    "green": "Sentinel-2 green band",
    "red": "Sentinel-2 red band",
    "nir": "Sentinel-2 NIR band",
    "swir1": "Sentinel-2 SWIR1 band",
    "swir2": "Sentinel-2 SWIR2 band",
    "ndvi": "NDVI (vegetation index)",
    "ndbi": "NDBI (built-up index)",
    "nbr": "NBR (burn index)",
    "satellite_data_available": "Sentinel-2 coverage",
    "is_vegetated": "Vegetated pixel",
    "is_built_up": "Built-up pixel",
    "burn_signal": "Burn signal",
}
LAND_COVER_LABELS = {
    "bare_sparse": "bare / sparse land", "built_up": "built-up land", "cropland": "cropland",
    "grassland": "grassland", "shrubland": "shrubland", "tree_cover": "tree cover",
    "water": "water", "wetland": "wetland",
}
CLASS_LABELS = {
    "agricultural": "agricultural burning", "flare": "a gas flare", "industrial": "industrial activity",
    "mining": "persistent mining", "offshore_flare_or_platform": "an offshore flare or platform",
    "wildfire": "a wildfire",
}


class ClassificationRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    frp: float = Field(gt=0, description="Fire radiative power in MW")
    brightness: float | None = Field(default=None, gt=0, description="Brightness temperature in K")


@lru_cache
def assets() -> tuple[pd.DataFrame, object, object, list[str], dict[str, object]]:
    """Load the verified pipeline artifacts once, on first classify request.
    Still CSV-backed: /api/classify needs the full ML feature row (land
    cover, OSM distance, spectral indices...) for the nearest-historic-point
    lookup, which the lighter PostGIS `detections` table doesn't carry."""
    df = pd.read_csv(PREDICTIONS_PATH)
    model = joblib.load(MODEL_DIR / "model_xgboost_v2.joblib")
    label_encoder = joblib.load(MODEL_DIR / "label_encoder_v2.joblib")
    features = joblib.load(MODEL_DIR / "feature_list_v2.joblib")
    encoders = joblib.load(MODEL_DIR / "categorical_encoders_v2.joblib")
    return df, model, label_encoder, features, encoders


def ui_category(category: str) -> str:
    return UI_CATEGORY.get(category, category)


@lru_cache
def postgis_available() -> bool:
    """Check configured spatial storage once; transparently retain CSV mode on a fresh setup."""
    if engine is None:
        return False
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1 FROM detections LIMIT 1"))
        return True
    except Exception:
        return False


def detection_record(row: pd.Series, confidence: float = 0.82) -> dict:
    category = ui_category(str(row.category))
    persistence = float(row.persistence_count_30d)
    persistent = persistence >= 4 or category in {"mining", "flare"}
    return {
        "id": f"FIRMS-{int(row.point_id):05d}",
        "region": REGION_LABELS.get(str(row.region), str(row.region).replace("_", " ").title()),
        "regionId": REGION_IDS.get(str(row.region), str(row.region)),
        "lat": float(row.latitude), "lng": float(row.longitude), "category": category,
        "confidence": round(float(confidence), 3), "frp": round(float(row.frp), 2),
        "firstDetected": str(row.acq_date), "persistent": persistent,
        "activeMonths": round(persistence / 30, 1) if persistent else 0,
        "anomaly": bool(row.is_anomalous),
    }


def nearest_reference(df: pd.DataFrame, lat: float, lng: float) -> pd.Series:
    """Fill unavailable satellite/context fields from the closest historic FIRMS point."""
    distance = (df.latitude - lat) ** 2 + ((df.longitude - lng) * np.cos(np.radians(lat))) ** 2
    return df.loc[distance.idxmin()].copy()


def _pretty_number(value: float) -> str:
    number = float(value)
    if abs(number) >= 100 or abs(number - round(number)) < 0.05:
        return str(int(round(number)))
    return f"{number:.2f}".rstrip("0").rstrip(".")


def format_feature_value(name: str, row: pd.Series) -> str:
    raw = row.get(name)
    if name == "frp":
        return f"{float(raw):.1f} MW"
    if name in {"bright_ti4", "bright_ti5"}:
        return f"{float(raw):.0f} K"
    if name == "brightness_temp_diff":
        return f"{float(raw):.1f} K"
    if name.startswith("dist_to_"):
        return f"{float(raw):.1f} km"
    if name.startswith("persistence_count_"):
        count = int(round(float(raw)))
        return f"{count} detection{'s' if count != 1 else ''}"
    if name == "location_night_fraction":
        return f"{float(raw) * 100:.0f}% night-time"
    if name in {"is_vegetated", "is_built_up", "satellite_data_available", "burn_signal"}:
        return "yes" if float(raw) >= 0.5 else "no"
    if name == "land_cover_class_enc":
        cover = str(row.get("land_cover_class", ""))
        return LAND_COVER_LABELS.get(cover, cover.replace("_", " ") or _pretty_number(raw))
    if name == "industrial_polygon_type_enc":
        polygon = str(row.get("industrial_polygon_type", "none")).replace("_", " ")
        return polygon
    if name == "daynight_enc":
        return "night" if str(row.get("daynight", "")).upper().startswith("N") else "day"
    if name == "confidence_enc":
        flag = str(row.get("confidence", raw))
        return {"h": "high", "n": "nominal", "l": "low"}.get(flag, str(flag))
    if name in {"satellite_enc", "instrument_enc"}:
        key = name.replace("_enc", "")
        return str(row.get(key, raw))
    if pd.isna(raw):
        return "unavailable"
    return _pretty_number(raw)


def feature_contributions(model, frame: pd.DataFrame, class_index: int) -> tuple[np.ndarray, float]:
    """Tree SHAP contributions for one XGBoost class, excluding the bias term."""
    booster = model.get_booster()
    contribs = booster.predict(xgb.DMatrix(frame, feature_names=list(frame.columns)), pred_contribs=True)
    matrix = np.asarray(contribs)
    if matrix.ndim == 3:
        vector = matrix[0, class_index]
    else:
        width = matrix.shape[1] // model.n_classes_
        vector = matrix[0, class_index * width:(class_index + 1) * width]
    return vector[:-1], float(vector[-1])


def explain_prediction(
    *,
    request: ClassificationRequest,
    row: pd.Series,
    features: list[str],
    model,
    label_encoder,
    raw_class: str,
    category: str,
    confidence: float,
    reference_distance_km: float,
) -> dict:
    frame = pd.DataFrame([row[features]])
    class_index = int(np.where(label_encoder.classes_ == raw_class)[0][0])
    contribs, _bias = feature_contributions(model, frame, class_index)
    ranked = sorted(zip(features, contribs, strict=True), key=lambda item: abs(float(item[1])), reverse=True)
    drivers = []
    for name, contribution in ranked[:6]:
        amount = float(contribution)
        drivers.append({
            "feature": FEATURE_LABELS.get(name, name.replace("_", " ")),
            "value": format_feature_value(name, row),
            "contribution": round(amount, 4),
            "direction": "supports" if amount >= 0 else "opposes",
            "source": "submitted" if name == "frp" or (request.brightness is not None and name in {"bright_ti4", "bright_ti5", "frp_to_temp_ratio"}) else "nearby historic observation",
        })
    class_phrase = CLASS_LABELS.get(raw_class, raw_class.replace("_", " "))
    ui_phrase = CLASS_LABELS.get(category, category)
    supporting = [item for item in drivers if item["direction"] == "supports"][:3]
    if supporting:
        reasons = "; ".join(f"{item['feature']} = {item['value']}" for item in supporting)
        summary = (
            f"The saved AGNI XGBoost model classified this location as {ui_phrase} "
            f"({round(confidence * 100)}% confidence) mainly because {reasons}."
        )
    else:
        summary = (
            f"The saved AGNI XGBoost model classified this location as {ui_phrase} "
            f"({round(confidence * 100)}% confidence) from the combined thermal, land-cover, and persistence features."
        )
    if raw_class != category and ui_category(raw_class) == category:
        summary += f" Internally it scored the more specific class {class_phrase}."
    land_cover = LAND_COVER_LABELS.get(str(row.get("land_cover_class", "")), str(row.get("land_cover_class", "")).replace("_", " "))
    context = [
        f"Land cover at the matched historic pixel: {land_cover or 'unknown'}.",
        f"Neighborhood distances: {float(row['dist_to_farmland_km']):.1f} km to farmland, "
        f"{float(row['dist_to_industrial_km']):.1f} km to industry, {float(row['dist_to_mining_km']):.1f} km to mining.",
        f"Persistence at that pixel: {int(round(float(row['persistence_count_30d'])))} "
        f"detection{'s' if int(round(float(row['persistence_count_30d']))) != 1 else ''} in 30 days, "
        f"{int(round(float(row['persistence_count_365d'])))} in the last year.",
        f"Sentinel-2 / OSM context was borrowed from the nearest historic FIRMS observation "
        f"({reference_distance_km:.0f} km away), because those fields are not entered in this panel.",
    ]
    if request.brightness is None:
        context.append("No brightness temperature was submitted, so I4/I5 thermal bands also came from that nearby observation.")
    signals = [summary, *context[:3]]
    return {
        "summary": summary,
        "model": "XGBoost v2",
        "rawClass": raw_class,
        "drivers": drivers,
        "context": context,
        "referenceKm": round(reference_distance_km, 1),
    }


def predict(request: ClassificationRequest) -> dict:
    df, model, label_encoder, features, _ = assets()
    row = nearest_reference(df, request.lat, request.lng)
    row["frp"] = request.frp
    if request.brightness is not None:
        row["bright_ti4"] = request.brightness
        row["bright_ti5"] = request.brightness - float(row["brightness_temp_diff"])
    row["frp_to_temp_ratio"] = request.frp / max(float(row["bright_ti4"]), 1)
    row["footprint_proxy"] = float(row["scan"]) * float(row["track"])
    probabilities = model.predict_proba(pd.DataFrame([row[features]]))[0]
    raw_scores = dict(zip(label_encoder.classes_, probabilities, strict=True))
    scores = {key: 0.0 for key in ("industrial", "flare", "agricultural", "wildfire", "mining")}
    for key, value in raw_scores.items():
        scores[ui_category(str(key))] += float(value)
    category = max(scores, key=scores.get)
    confidence = scores[category]
    raw_class = str(max(raw_scores, key=raw_scores.get))
    reference_distance = float(np.sqrt((float(row.latitude) - request.lat) ** 2 + (float(row.longitude) - request.lng) ** 2) * 111)
    try:
        explanation = explain_prediction(
            request=request, row=row, features=features, model=model, label_encoder=label_encoder,
            raw_class=raw_class, category=category, confidence=confidence, reference_distance_km=reference_distance,
        )
    except Exception:
        explanation = {
            "summary": (
                f"The saved AGNI XGBoost model classified this location as {CLASS_LABELS.get(category, category)} "
                f"({round(confidence * 100)}% confidence) using thermal, land-cover, persistence, and Sentinel-2 features."
            ),
            "model": "XGBoost v2",
            "rawClass": raw_class,
            "drivers": [],
            "context": [
                f"Satellite, land-cover, and persistence context came from the nearest historic observation ({reference_distance:.0f} km away).",
                f"Submitted thermal signal: {request.frp:.1f} MW FRP"
                + (f", {request.brightness:.0f} K brightness." if request.brightness else "."),
            ],
            "referenceKm": round(reference_distance, 1),
        }
    return {
        "category": category,
        "confidence": confidence,
        "scores": scores,
        "signals": [explanation["summary"], *explanation["context"]],
        "explanation": explanation,
    }


app = FastAPI(title="Pyrolens Fire Detection API", version="3.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health() -> dict:
    if postgis_available():
        with engine.connect() as conn:
            count = conn.execute(text("SELECT count(*) FROM detections")).scalar_one()
        storage = "PostGIS"
    else:
        df, *_ = assets()
        count, storage = len(df), "CSV fallback (set DATABASE_URL for PostGIS)"
    return {"status": "ok", "detections": count, "model": "XGBoost v2", "storage": storage}


@app.get("/api/detections")
def detections(region: str | None = None, limit: Annotated[int, Query(ge=1, le=10000)] = 3000) -> list[dict]:
    """Use PostGIS when configured, otherwise retain a responsive real-CSV map."""
    if not postgis_available():
        df, model, _, features, _ = assets()
        subset = df if not region or region == "all" else df[df.region == region]
        if subset.empty:
            raise HTTPException(status_code=404, detail="Unknown region")
        if len(subset) > limit:
            subset = subset.sample(n=limit, random_state=42)
        confidences = model.predict_proba(subset[features]).max(axis=1)
        return [detection_record(row, confidence) for (_, row), confidence in zip(subset.iterrows(), confidences, strict=True)]

    where_clause = "WHERE region = :region" if region and region != "all" else ""
    sql = text(f"""
        SELECT point_id, region, category, confidence, frp, latitude, longitude,
               acq_date, persistence_30d, is_anomalous
        FROM detections
        {where_clause}
        ORDER BY random()
        LIMIT :limit
    """)
    params: dict[str, object] = {"limit": limit}
    if region and region != "all":
        params["region"] = region

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()

    if not rows and region and region != "all":
        raise HTTPException(status_code=404, detail="Unknown region")

    return [
        {
            "id": f"FIRMS-{r['point_id']:05d}",
            "region": REGION_LABELS.get(r["region"], r["region"].replace("_", " ").title()),
            "regionId": REGION_IDS.get(r["region"], r["region"]),
            "lat": r["latitude"], "lng": r["longitude"],
            "category": ui_category(r["category"]), "confidence": round(r["confidence"], 3),
            "frp": round(r["frp"], 2), "firstDetected": str(r["acq_date"]),
            "persistent": (r["persistence_30d"] or 0) >= 4,
            "activeMonths": round((r["persistence_30d"] or 0) / 30, 1),
            "anomaly": bool(r["is_anomalous"]),
        }
        for r in rows
    ]


@app.get("/api/detections/nearby")
def nearby(lat: float, lng: float, radius_km: float = 50, limit: Annotated[int, Query(ge=1, le=1000)] = 200) -> list[dict]:
    """Genuine spatial query using the GIST index -- everything within
    radius_km of a point. No equivalent on a flat CSV without scanning
    and computing distance for every row on every request."""
    if not postgis_available():
        df, *_ = assets()
        lat_delta = np.radians(df.latitude - lat)
        lng_delta = np.radians(df.longitude - lng)
        a = np.sin(lat_delta / 2) ** 2 + np.cos(np.radians(lat)) * np.cos(np.radians(df.latitude)) * np.sin(lng_delta / 2) ** 2
        candidates = df.assign(km_away=6371 * 2 * np.arcsin(np.sqrt(a)))
        candidates = candidates[candidates.km_away <= radius_km].nsmallest(limit, "km_away")
        return [{"point_id": int(row.point_id), "region": row.region, "category": ui_category(row.category), "frp": float(row.frp), "latitude": float(row.latitude), "longitude": float(row.longitude), "km_away": round(float(row.km_away), 2)} for _, row in candidates.iterrows()]

    sql = text("""
        SELECT point_id, region, category, frp, latitude, longitude,
               ROUND((ST_Distance(geom::geography,
                     ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) / 1000)::numeric, 2) AS km_away
        FROM detections
        WHERE ST_DWithin(geom::geography,
                          ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                          :radius_m)
        ORDER BY km_away
        LIMIT :limit
    """)
    with engine.connect() as conn:
        rows = conn.execute(sql, {
            "lat": lat, "lng": lng, "radius_m": radius_km * 1000, "limit": limit,
        }).mappings().all()
    return [dict(r) for r in rows]


@app.get("/api/regions/summary")
def regions_summary() -> list[dict]:
    """Category counts per region, aggregated by Postgres itself."""
    if not postgis_available():
        df, *_ = assets()
        summary = df.assign(category=df.category.map(ui_category)).groupby(["region", "category"], as_index=False).size().rename(columns={"size": "n"})
        return summary.sort_values(["region", "n"], ascending=[True, False]).to_dict(orient="records")

    sql = text("""
        SELECT region, category, count(*) AS n
        FROM detections
        GROUP BY region, category
        ORDER BY region, n DESC
    """)
    with engine.connect() as conn:
        rows = conn.execute(sql).mappings().all()
    return [dict(r) for r in rows]


@app.post("/api/classify")
def classify(request: ClassificationRequest) -> dict:
    return predict(request)


DIST_DIR = ROOT / "dist"
if DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="dashboard")
