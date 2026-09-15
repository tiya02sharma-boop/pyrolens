"""AGNI API — now backed by PostGIS instead of a flat CSV.

This file shows the *changes* to app.py needed to move from
`pd.read_csv(...)` to real spatial-database queries. Merge these pieces
into your existing app.py (imports, DB engine setup, and the two
modified/added endpoints), keeping /api/classify exactly as it was —
that one still needs the loaded ML model, not the database.
"""
from __future__ import annotations

from pathlib import Path
from typing import Annotated

import joblib
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, text

ROOT = Path(__file__).parent
MODEL_DIR = ROOT / "models"
DB_URL = "postgresql+psycopg2://postgres:agni123@localhost:5432/agni_gis"
engine = create_engine(DB_URL, pool_pre_ping=True)

app = FastAPI(title="AGNI Fire Detection API", version="3.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health() -> dict:
    with engine.connect() as conn:
        count = conn.execute(text("SELECT count(*) FROM detections")).scalar_one()
    return {"status": "ok", "detections": count, "storage": "PostGIS"}


@app.get("/api/detections")
def detections(region: str | None = None, limit: Annotated[int, Query(ge=1, le=10000)] = 3000) -> list[dict]:
    """Now a real spatial-database query instead of a pandas filter on a loaded CSV."""
    where_clause = "WHERE region = :region" if region and region != "all" else ""
    sql = text(f"""
        SELECT id, point_id, region, category, confidence, frp,
               latitude, longitude, acq_date, persistence_30d,
               is_anomalous
        FROM detections
        {where_clause}
        ORDER BY random()
        LIMIT :limit
    """)
    params = {"limit": limit}
    if region and region != "all":
        params["region"] = region

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()

    if not rows and region and region != "all":
        raise HTTPException(status_code=404, detail="Unknown region")

    return [
        {
            "id": f"FIRMS-{r['point_id']:05d}",
            "region": r["region"],
            "regionId": r["region"].replace("_", "-"),
            "lat": r["latitude"], "lng": r["longitude"],
            "category": r["category"], "confidence": round(r["confidence"], 3),
            "frp": r["frp"], "firstDetected": str(r["acq_date"]),
            "persistent": (r["persistence_30d"] or 0) >= 4,
            "anomaly": bool(r["is_anomalous"]),
        }
        for r in rows
    ]


@app.get("/api/detections/nearby")
def nearby(lat: float, lng: float, radius_km: float = 50, limit: Annotated[int, Query(ge=1, le=1000)] = 200) -> list[dict]:
    """Genuine spatial query -- everything within radius_km of a point,
    using the GIST spatial index. This has no equivalent on a flat CSV
    without scanning and computing distance for every single row."""
    sql = text("""
        SELECT id, point_id, region, category, frp, latitude, longitude,
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
    """Aggregation pushed down to the database -- category counts per
    region, computed by PostGIS/Postgres rather than pulled into Python."""
    sql = text("""
        SELECT region, category, count(*) AS n
        FROM detections
        GROUP BY region, category
        ORDER BY region, n DESC
    """)
    with engine.connect() as conn:
        rows = conn.execute(sql).mappings().all()
    return [dict(r) for r in rows]


# /api/classify stays exactly as in your current app.py -- it needs the
# loaded model + nearest-historic-point lookup, not the detections table.
# Keep that endpoint's code as-is when merging this in.

DIST_DIR = ROOT / "dist"
if DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="dashboard")
