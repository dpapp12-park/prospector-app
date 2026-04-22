-- sql/migrations/2026-04-22_military_lands.sql
-- Unworked Gold — Data Foundation Step 2
-- Dataset: MIRTA (Military Installations, Ranges, and Training Areas)
-- Source: NTAD Military Bases FeatureServer, FY2024 BSR
-- Schema note: schema_notes/military_lands.md
-- Session 16 — April 22, 2026

-- Landing table per Data_Foundation.md Section 1 JSONB pattern.
-- source_id = `mirtaLocationsIdpk` from NTAD (DISDI Primary Key Identifier,
-- non-nullable, stable across publishes). See schema note for rationale.
-- Geometry column generic (polygon / multipolygon both acceptable), WGS84.

CREATE TABLE military_lands (
  id          BIGSERIAL PRIMARY KEY,
  source_id   TEXT NOT NULL UNIQUE,
  raw         JSONB NOT NULL,
  geometry    GEOMETRY(Geometry, 4326),
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_military_lands_raw  ON military_lands USING GIN  (raw);
CREATE INDEX idx_military_lands_geom ON military_lands USING GIST (geometry);

-- Row-Level Security: enable with a read-only public policy.
-- Matches pattern used for other read-only reference tables in the project.
-- Prospectors should be able to see boundaries via anon role; no write access.
ALTER TABLE military_lands ENABLE ROW LEVEL SECURITY;

CREATE POLICY military_lands_public_read
  ON military_lands
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Grants: anon + authenticated can SELECT. No INSERT/UPDATE/DELETE via PostgREST.
-- Loader script will connect as the service-role user, which bypasses RLS.
GRANT SELECT ON military_lands TO anon, authenticated;

COMMENT ON TABLE military_lands IS
  'MIRTA military installation boundaries. Source: NTAD Military Bases FeatureServer, FY2024 BSR. Populated by loaders/load_military_lands.py.';
COMMENT ON COLUMN military_lands.source_id IS
  'NTAD OBJECTID (cast to TEXT). Not stable across annual BSR republishes; acceptable because refresh cadence is TRUNCATE + full reload. See schema_notes/military_lands.md for why mirtaLocationsIdpk and sdsId were rejected.';
COMMENT ON COLUMN military_lands.raw IS
  'Full feature properties from source. Every field captured, no filtering. See schema_notes/military_lands.md.';
