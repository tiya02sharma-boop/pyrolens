-- AGNI PostGIS schema
-- Run: psql -d agni_gis -f 01_schema.sql

CREATE TABLE IF NOT EXISTS detections (
    id              SERIAL PRIMARY KEY,
    point_id        INTEGER,
    region          TEXT,
    acq_date        DATE,
    acq_time        INTEGER,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    frp             DOUBLE PRECISION,
    bright_ti4      DOUBLE PRECISION,
    bright_ti5      DOUBLE PRECISION,
    daynight        TEXT,
    category        TEXT NOT NULL,
    confidence      DOUBLE PRECISION,
    persistence_30d DOUBLE PRECISION,
    is_anomalous    BOOLEAN DEFAULT FALSE,
    anomaly_score   DOUBLE PRECISION,
    geom            GEOMETRY(Point, 4326) NOT NULL
);

-- Migration for existing deployments:
ALTER TABLE detections ADD COLUMN IF NOT EXISTS acq_time INTEGER;

-- The spatial index -- this is what makes radius/bbox queries fast
-- instead of scanning every row, which a flat CSV can never do.
CREATE INDEX IF NOT EXISTS idx_detections_geom ON detections USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_detections_category ON detections (category);
CREATE INDEX IF NOT EXISTS idx_detections_region ON detections (region);
CREATE INDEX IF NOT EXISTS idx_detections_date ON detections (acq_date);
