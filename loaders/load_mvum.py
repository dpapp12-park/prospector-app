"""
load_mvum.py
Unworked Gold — USFS MVUM loader (Roads + Trails).

Creates two Supabase tables (mvum_roads, mvum_trails) if missing,
fetches all records from the USDA Forest Service EDW_MVUM_01
endpoint, and UPSERTs into Supabase via the pooler connection.

Reads credentials from .env per F.9 (python-dotenv).
Source schema note: schema_notes/mvum.md (Session 18).

Run:
    python load_mvum.py

Re-running is safe — UPSERT on source_id=globalid.
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
BASE = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer"
LAYERS = [
    {"id": 1, "table": "mvum_roads",  "label": "Roads"},
    {"id": 2, "table": "mvum_trails", "label": "Trails"},
]
PAGE_SIZE = 2000  # MaxRecordCount per source endpoint
HTTP_TIMEOUT = 60
HTTP_RETRIES = 3

# ── DB connection via pooler + .env ─────────────────────
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
print("[OK] Schema ensured for mvum_roads + mvum_trails")


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
    last = None
    for attempt in range(1, HTTP_RETRIES + 1):
        try:
            r = requests.get(url, params=params, timeout=HTTP_TIMEOUT)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last = e
            print(f"  retry {attempt}/{HTTP_RETRIES}: {e}")
            time.sleep(2 * attempt)
    raise RuntimeError(f"fetch_page failed after {HTTP_RETRIES}: {last}")


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
    rows = []
    skipped = 0
    for f in features:
        props = f.get("properties") or {}
        geom = f.get("geometry")
        # MVUM globalid field — cased per layer output; try both
        sid = (props.get("globalid")
               or props.get("GLOBALID")
               or props.get("OBJECTID")
               or props.get("objectid"))
        if sid is None:
            skipped += 1
            continue
        rows.append((
            str(sid),
            json.dumps(props),
            json.dumps(geom) if geom else None,
        ))
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
            print(f"  sample row keys ({len(keys)}): {keys[:6]}...{keys[-3:]}")

conn.close()
print("\n[DONE]")
