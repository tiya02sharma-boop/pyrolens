"""
Loads outputs/firms_combined_with_predictions_v2.csv into the PostGIS
`detections` table. It imports a reproducible 5,000-row prototype sample by
default; set ``LOAD_LIMIT=0`` to load the full dataset.

    python3 gis/02_load_data.py
"""
import os
import pandas as pd
from sqlalchemy import create_engine, text

DB_URL = os.getenv("DATABASE_URL")
CSV_PATH = "outputs/firms_combined_with_predictions_v2.csv"
UI_CATEGORY = {"offshore_flare_or_platform": "flare"}
LOAD_LIMIT = int(os.getenv("LOAD_LIMIT", "5000"))


def main():
    if not DB_URL:
        raise SystemExit("Set DATABASE_URL before loading PostGIS, e.g. postgresql+psycopg2://user:password@localhost:5432/agni_gis")
    print("Reading CSV...")
    df = pd.read_csv(CSV_PATH, low_memory=False)
    print(f"  {len(df)} rows")

    df["category"] = df["category"].map(lambda c: UI_CATEGORY.get(c, c))
    df = df[~df["category"].isin(["unlabeled"])].copy()
    print(f"  {len(df)} rows after dropping unlabeled")
    if LOAD_LIMIT > 0 and len(df) > LOAD_LIMIT:
        df = df.sample(n=LOAD_LIMIT, random_state=42).copy()
        print(f"  limited to {len(df)} reproducible prototype rows")

    engine = create_engine(DB_URL)

    # Reset the historical snapshot before importing it. Each insert batch is
    # committed separately below: an external Render database connection can
    # time out during a large import, and independent commits prevent one
    # failed batch from rolling back the batches that already completed.
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE TABLE detections RESTART IDENTITY;"))

    rows = df[[
        "point_id", "region", "acq_date", "latitude", "longitude", "frp",
        "bright_ti4", "bright_ti5", "daynight", "category",
        "persistence_count_30d", "is_anomalous", "anomaly_score",
    ]].copy()
    rows["confidence"] = 0.9  # placeholder; real per-row confidence comes from model.predict_proba at query time if needed
    rows = rows.rename(columns={"persistence_count_30d": "persistence_30d"})

    print("Inserting rows with geometry...")
    insert_sql = text("""
        INSERT INTO detections
            (point_id, region, acq_date, latitude, longitude, frp,
             bright_ti4, bright_ti5, daynight, category, confidence,
             persistence_30d, is_anomalous, anomaly_score, geom)
        VALUES
            (:point_id, :region, :acq_date, :latitude, :longitude, :frp,
             :bright_ti4, :bright_ti5, :daynight, :category, :confidence,
             :persistence_30d, :is_anomalous, :anomaly_score,
             ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326))
    """)
    records = rows.to_dict(orient="records")
    batch_size = 500
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        with engine.begin() as conn:
            conn.execute(insert_sql, batch)
        print(f"  inserted {min(i + batch_size, len(records))}/{len(records)}")

    print("Done.")


if __name__ == "__main__":
    main()
