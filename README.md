# AGNI — Satellite Thermal Hotspot Intelligence

AGNI classifies NASA FIRMS thermal hotspots as agricultural burning, wildfire,
industrial activity, mining activity, or gas flare. It combines VIIRS thermal
signals with historical persistence, Sentinel-2 context, and land-use features.

The dashboard shows hotspots on a globe, flags anomalies, explains a new model
prediction in Detection Details, and—for new industrial classifications—looks
up nearby mapped facilities to suggest a possible industrial source.

## Run locally

You need Python 3.10+ and Node.js 18+.

```bash
pip install -r requirements.txt
python -m uvicorn app:app --reload
```

In another terminal:

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

For a production-style local build:

```bash
npm run build
python -m uvicorn app:app
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## What the classifier returns

The XGBoost model predicts a hotspot category and a confidence score. It also
returns scores for every category and feature-level explanation data.

The dashboard displays the explanation only in **Detection Details** after a
new classification. If the result is **Industrial activity**, AGNI runs a
separate OpenStreetMap proximity check to show a possible nearby facility,
facility type, distance, and evidence. This is source context, not proof that
the facility caused the event.

## Data storage

By default, the app works from the verified prediction CSV in `outputs/`.
No database is required for a local demo.

Manual **Classify New Detection** results are added to the globe for the
current browser session only; they are not saved after a refresh.

Optional PostGIS storage persists the historical dataset and can persist live
FIRMS ingestion results.

## Optional: enable PostGIS

Set `DATABASE_URL` to a PostgreSQL database with the PostGIS extension. Use a
standard PostgreSQL URL with `psql` (without the SQLAlchemy `+psycopg2` suffix),
then load the data:

```bash
psql "postgresql://USER:PASSWORD@HOST:5432/agni_gis" -f gis/01_schema.sql
python gis/02_load_data.py
```

Restart the API and verify that it is using the database:

```bash
curl http://127.0.0.1:8000/api/health
```

The response should contain:

```json
"storage": "PostGIS"
```

PostGIS enables spatial radius queries and database-side regional summaries:

```bash
curl "http://127.0.0.1:8000/api/detections/nearby?lat=22.35&lng=70.05&radius_km=20"
curl http://127.0.0.1:8000/api/regions/summary
```

## Optional: live FIRMS ingestion

To fetch and store new NASA FIRMS detections, configure all three variables:

```bash
export DATABASE_URL="postgresql+psycopg2://USER:PASSWORD@HOST:5432/agni_gis"
export FIRMS_MAP_KEY="your_nasa_firms_map_key"
export FIRMS_POLL_TOKEN="a_secret_token"
```

Then run:

```bash
python gis/03_realtime_poller.py
```

The poller fetches new hotspot data for AGNI’s monitored regions, removes
duplicates, classifies each detection, and inserts it into PostGIS.

## Project layout

```text
app.py              FastAPI backend and model API
src/                React dashboard
models/             Trained XGBoost and support artifacts
outputs/             Verified prediction output
gis/                PostGIS schema, loader, and live FIRMS poller
notebooks/           Data preparation, training, and evaluation notebooks
```

## Model evaluation note

The saved model was evaluated with a spatial-block train/test split. Its test
accuracy is 98.1% and macro F1 is 90.7%. These scores apply to the evaluation
dataset; they are not a guarantee of real-world performance for new manually
entered coordinates.
