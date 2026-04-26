"""
load_plad.py
Unworked Gold — BLM Public Lands Access Database (PLAD) loader.

Source: MAPLand Act 2022 dataset. Federal interests in private land
providing legal access (public recreational + administrative) to
federal land. Closes the "can I legally reach this claim?" question.

Two landing tables:
- plad_easements (lines, 4,675 records) — access routes
- plad_reservations (polygons, 89 records) — access areas

Reads credentials from .env per F.9.

Run:
    python load_plad.py
"""

import os
import sys
import time
import json
import requests
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

# ── Config ─────────────────────────────────────────────
BASE = "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_PLAD/MapServer"
LAYERS = [
    {"id": 0, "table": "plad_easements",    "label": "Easements (Lines)"},
    {"id": 1, "table": "plad_reservations", "label": "Reservations (Polygons)"},
]
PAGE_SIZE = 1000
HTTP_TIMEOUT = 60
HTTP_RETRIES = 3
HTTP_BACKOFF = 3

# ── DB connection ──────────────────────────────────────
load_dotenv()
try:
    conn = psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASS"],
    )
    conn.autocommit = False
    print(f"[OK] Connected to {os.environ['DB_HOST']}")
except KeyError as e:
    sys.exit(f"[FAIL] Missing env var: {e}. Check .env.")
except Exception as e:
    sys.exit(f"[FAIL] DB connect: {e}")


# ── Schema (idempotent) ─────────────────────────────────
DDL = """
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS {table} (
    id BIGSERIAL PRIMARY KEY,
    source_id TEXT NOT NULL UNIQUE,
    raw JSONB NOT NULL,
    geometry GEOMETRY(Geometry, 4326),
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_{table}_raw  ON {table} USING GIN  (raw);
CREATE INDEX IF NOT EXISTS idx_{table}_geom ON {table} USING GIST (geometry);

ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = '{table}' AND policyname = '{table}_public_read'
    ) THEN
        CREATE POLICY {table}_public_read ON {table} FOR SELECT USING (true);
    END IF;
END$$;

GRANT SELECT ON {table} TO anon, authenticated;
"""

with conn.cursor() as cur:
    for layer in LAYERS:
        cur.execute(DDL.format(table=layer["table"]))
    conn.commit()
print("[OK] Schema ensured for plad_easements + plad_reservations")


# ── Fetch one page ──────────────────────────────────────
def fetch_page(layer_id, offset):
    url = f"{BASE}/{layer_id}/query"
    params = {
        "where": "1=1",
        "outFields": "*",
        "outSR": 4326,
        "resultOffset": offset,
        "resultRecordCount": PAGE_SIZE,
        "f": "geojson",
        "returnGeometry": "true",
    }
    for attempt in range(1, HTTP_RETRIES + 1):
        try:
            r = requests.get(url, params=params, timeout=HTTP_TIMEOUT)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            sleep = HTTP_BACKOFF * attempt
            print(f"  retry {attempt}/{HTTP_RETRIES} after {sleep}s: {e}")
            time.sleep(sleep)
    return None


# ── UPSERT a batch ──────────────────────────────────────
UPSERT_SQL = """
INSERT INTO {table} (source_id, raw, geometry)
VALUES %s
ON CONFLICT (source_id) DO UPDATE SET
    raw = EXCLUDED.raw,
    geometry = EXCLUDED.geometry,
    ingested_at = NOW();
"""

def upsert_features(table, features):
    if not features:
        return 0
    by_sid = {}
    skipped = 0
    for f in features:
        props = f.get("properties") or {}
        geom = f.get("geometry")
        sid = (props.get("OBJECTID")
               or props.get("objectid"))
        if sid is None:
            skipped += 1
            continue
        by_sid[str(sid)] = (
            str(sid),
            json.dumps(props),
            json.dumps(geom) if geom else None,
        )
    rows = list(by_sid.values())
    if not rows:
        return 0
    with conn.cursor() as cur:
        execute_values(
            cur,
            UPSERT_SQL.format(table=table),
            rows,
            template="(%s, %s::jsonb, ST_GeomFromGeoJSON(%s))",
            page_size=500,
        )
    conn.commit()
    if skipped:
        print(f"  skipped {skipped} rows missing id")
    return len(rows)


# ── Main ingest loop ───────────────────────────────────
def ingest_layer(layer):
    label, lid, table = layer["label"], layer["id"], layer["table"]
    print(f"\n=== {label} (layer {lid} → {table}) ===")
    offset = 0
    total = 0
    page_num = 0
    t0 = time.time()

    while True:
        page_num += 1
        page = fetch_page(lid, offset)
        if page is None:
            print(f"  [SKIP] offset {offset} failed after retries")
            break
        feats = page.get("features", [])
        if not feats:
            break
        written = upsert_features(table, feats)
        total += written
        elapsed = time.time() - t0
        rate = total / elapsed if elapsed > 0 else 0
        print(f"  page {page_num}: +{written}  (total {total}, {rate:.0f}/sec)")
        if len(feats) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    print(f"[OK] {label}: {total} rows in {time.time()-t0:.1f}s")
    return total


totals = {}
for layer in LAYERS:
    totals[layer["table"]] = ingest_layer(layer)


# ── Post-load verification ──────────────────────────────
print("\n=== Verification ===")
with conn.cursor() as cur:
    for layer in LAYERS:
        table = layer["table"]
        cur.execute(f"SELECT COUNT(*) FROM {table};")
        db_count = cur.fetchone()[0]
        ingested = totals[table]
        print(f"{table}: DB has {db_count} rows (this run ingested {ingested})")

        cur.execute(f"SELECT raw FROM {table} LIMIT 1;")
        sample = cur.fetchone()
        if sample:
            keys = list(sample[0].keys())
            print(f"  sample row keys ({len(keys)}): {keys}")

conn.close()
print("\n[DONE]")
