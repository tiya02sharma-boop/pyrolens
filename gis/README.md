# AGNI — PostGIS Storage Layer

`app.py` now stores and serves detections from a real spatial database
(PostgreSQL + PostGIS) instead of reading a flat CSV on every request.
`/api/classify` is unchanged — it still reads `outputs/firms_combined_with_predictions_v2.csv`
because the ML model needs the full enriched feature row (land cover, OSM
distance, spectral indices...) for its nearest-historic-point lookup, which
the lighter `detections` table intentionally doesn't duplicate.

## One-time setup

```bash
# 1. Install PostgreSQL + PostGIS
sudo apt-get install postgresql postgresql-contrib postgis postgresql-16-postgis-3
sudo service postgresql start

# 2. Create the database and enable PostGIS
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'agni123';"
sudo -u postgres createdb agni_gis
sudo -u postgres psql -d agni_gis -c "CREATE EXTENSION postgis;"

# 3. Apply the schema
sudo -u postgres psql -d agni_gis -f gis/01_schema.sql

# 4. Install Python drivers (already in requirements.txt)
pip install -r requirements.txt

# 5. Load your real predictions data into PostGIS
python3 gis/02_load_data.py
```

Re-run step 5 any time you retrain the model and regenerate
`outputs/firms_combined_with_predictions_v2.csv` — it truncates and
reloads the table.

## What changed in app.py

- `/api/detections` — now a real spatial-database query (`SELECT ... FROM detections`) instead of a pandas filter on a CSV loaded into memory.
- `/api/detections/nearby?lat=..&lng=..&radius_km=..` — **new**. A genuine proximity query using PostGIS's `ST_DWithin` against the GIST spatial index. No equivalent is possible on a flat CSV without scanning and computing distance for every row on every request.
- `/api/regions/summary` — **new**. Category counts per region, aggregated by Postgres itself (`GROUP BY`), not pulled into Python and counted there.
- `/api/classify` and `/api/health`'s model info — unchanged in logic; `/api/health` now also reports `"storage": "PostGIS"` and counts rows from the database.

## Verifying it works

```bash
curl http://localhost:8000/api/health
curl "http://localhost:8000/api/detections/nearby?lat=23.74&lng=86.42&radius_km=30"
curl "http://localhost:8000/api/regions/summary"
```

## Connection string

Set `DATABASE_URL` before running the loader. For example:
```
export DATABASE_URL="postgresql+psycopg2://postgres:your-password@localhost:5432/agni_gis"
```
Without this variable, AGNI continues to serve the verified prediction CSV; PostGIS is an opt-in storage layer.
