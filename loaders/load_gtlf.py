"""
load_gtlf.py
Unworked Gold — BLM Ground Transportation Linear Features loader.

Source: BLM's national transportation network for public use.
The BLM equivalent of MVUM (which is USFS-only).

Path B ingestion — 4 tables, no duplicates:
- gtlf_roads_motorized      (layer 0, ~108,343) — Open OHV roads
- gtlf_roads_limited        (layer 1, ~25,858)  — Restricted OHV roads
- gtlf_trails_motorized     (layer 2, ~1,925)   — Open OHV trails
- gtlf_trails_managed       (layer 7, ~19,108)  — All other trails
                                                  (non-motorized, non-mechanized,
                                                   unassessed, unknowns)

Layer 7 by BLM's own docs = layers 3-6 + ~4,001 unknown-OHV trails.
Layer 7 does NOT include layer 2 (motorized trails).
Loading layers 3-6 separately would duplicate layer 7 rows.

Reads credentials from .env per F.9.

Run:
    python load_gtlf.py
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
BASE = ("https://gis.blm.gov/arcgis/rest/services/transportation/"
        "BLM_Natl_GTLF_Public_Display/MapServer")
LAYERS = [
    {"id": 0, "table": "gtlf_roads_motorized",  "label": "Roads Managed for Public Motorized Use"},
    {"id": 1, "table": "gtlf_roads_limited",    "label": "Roads Managed for Limited Public Motorized Use"},
    {"id": 2, "table": "gtlf_trails_motorized", "label": "Trails Managed for Public Motorized Use"},
    {"id": 7, "table": "gtlf_trails_managed",   "label": "Trails Managed for Public (all other)"},
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
print(f"[OK] Schema ensured for {len(LAYERS)} GTLF tables")


# ── Resume support ──────────────────────────────────────
def existing_count(table):
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM {table};")
        return cur.fetchone()[0]


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
        "orderByFields": "OBJECTID",
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
    start_offset = existing_count(table)
    print(f"\n=== {label}")
    print(f"    layer {lid} → {table}  (resume from {start_offset})")

    offset = start_offset
    total_new = 0
    page_num = 0
    consecutive_failures = 0
    t0 = time.time()

    while True:
        page_num += 1
        page = fetch_page(lid, offset)
        if page is None:
            consecutive_failures += 1
            print(f"  [SKIP] offset {offset} failed after retries "
                  f"(failure {consecutive_failures}/3)")
            if consecutive_failures >= 3:
                print(f"  [ABORT] 3 consecutive failures, stopping this layer")
                break
            offset += PAGE_SIZE
            continue
        consecutive_failures = 0
        feats = page.get("features", [])
        if not feats:
            break
        written = upsert_features(table, feats)
        total_new += written
        elapsed = time.time() - t0
        rate = total_new / elapsed if elapsed > 0 else 0
        print(f"  page {page_num}: +{written}  "
              f"(this run {total_new}, {rate:.0f}/sec, offset now {offset+PAGE_SIZE})")
        if len(feats) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    final_count = existing_count(table)
    print(f"[OK] {label}: DB has {final_count} rows total "
          f"(this run ingested {total_new} in {time.time()-t0:.1f}s)")
    return total_new, final_count


results = {}
for layer in LAYERS:
    new, final = ingest_layer(layer)
    results[layer["table"]] = (new, final)


# ── Post-load verification ──────────────────────────────
print("\n=== Verification ===")
grand_total = 0
with conn.cursor() as cur:
    for layer in LAYERS:
        table = layer["table"]
        cur.execute(f"SELECT COUNT(*) FROM {table};")
        db_count = cur.fetchone()[0]
        new, _ = results[table]
        grand_total += db_count
        print(f"{table}: {db_count} rows  (this run +{new})")

        cur.execute(f"SELECT raw FROM {table} LIMIT 1;")
        sample = cur.fetchone()
        if sample:
            keys = list(sample[0].keys())
            print(f"  sample row keys ({len(keys)}): {keys[:10]}{'...' if len(keys)>10 else ''}")

print(f"\n[TOTAL] GTLF: {grand_total} rows across {len(LAYERS)} tables")
conn.close()
print("[DONE]")
