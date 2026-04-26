"""
load_plss_townships.py
Unworked Gold — PLSS Townships loader (BLM National PLSS, Layer 1 only).

Updates from first version:
- PAGE_SIZE reduced 2000 → 1000 (BLM server 500s at larger payloads).
- Resume support: starts from current row count in DB, not offset 0.
- Skip-and-continue on persistent page failure, reports failed offsets at end.

Reads credentials from .env per F.9 (python-dotenv).
Source scope: BLM_Natl_PLSS_CadNSDI/MapServer layer 1 (Township) only.
Sections and Intersected layers deferred.

Run (safe to re-run — resumes where it left off):
    python load_plss_townships.py
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
BASE = ("https://gis.blm.gov/arcgis/rest/services/Cadastral/"
        "BLM_Natl_PLSS_CadNSDI/MapServer")
LAYER_ID = 1
TABLE = "plss_townships"
PAGE_SIZE = 1000       # reduced from 2000 — BLM server 500s on larger batches
HTTP_TIMEOUT = 60
HTTP_RETRIES = 3
HTTP_BACKOFF = 3        # seconds × attempt

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
DDL = f"""
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS {TABLE} (
    id BIGSERIAL PRIMARY KEY,
    source_id TEXT NOT NULL UNIQUE,
    raw JSONB NOT NULL,
    geometry GEOMETRY(Geometry, 4326),
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_{TABLE}_raw  ON {TABLE} USING GIN  (raw);
CREATE INDEX IF NOT EXISTS idx_{TABLE}_geom ON {TABLE} USING GIST (geometry);

ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = '{TABLE}' AND policyname = '{TABLE}_public_read'
    ) THEN
        CREATE POLICY {TABLE}_public_read ON {TABLE} FOR SELECT USING (true);
    END IF;
END$$;

GRANT SELECT ON {TABLE} TO anon, authenticated;
"""

with conn.cursor() as cur:
    cur.execute(DDL)
    conn.commit()
print(f"[OK] Schema ensured for {TABLE}")


# ── Resume: start offset = current row count ───────────
with conn.cursor() as cur:
    cur.execute(f"SELECT COUNT(*) FROM {TABLE};")
    existing = cur.fetchone()[0]
if existing > 0:
    print(f"[RESUME] {existing} rows already present, starting at offset {existing}")
else:
    print(f"[START] empty table, starting at offset 0")


# ── Fetch one page ──────────────────────────────────────
def fetch_page(offset):
    url = f"{BASE}/{LAYER_ID}/query"
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
            sleep = HTTP_BACKOFF * attempt
            print(f"  retry {attempt}/{HTTP_RETRIES} after {sleep}s: {e}")
            time.sleep(sleep)
    # Persistent failure — caller decides what to do
    return None


# ── UPSERT a batch ──────────────────────────────────────
UPSERT_SQL = f"""
INSERT INTO {TABLE} (source_id, raw, geometry)
VALUES %s
ON CONFLICT (source_id) DO UPDATE SET
    raw = EXCLUDED.raw,
    geometry = EXCLUDED.geometry,
    ingested_at = NOW();
"""

def upsert_features(features):
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
            UPSERT_SQL,
            rows,
            template="(%s, %s::jsonb, ST_GeomFromGeoJSON(%s))",
            page_size=500,
        )
    conn.commit()
    if skipped:
        print(f"  skipped {skipped} rows missing id")
    return len(rows)


# ── Main ingest loop ───────────────────────────────────
print(f"\n=== PLSS Townships (layer {LAYER_ID} → {TABLE}) ===")
offset = existing
total = 0
page_num = 0
failed_offsets = []
t0 = time.time()

while True:
    page_num += 1
    page = fetch_page(offset)
    if page is None:
        # Persistent failure — skip this offset, continue
        print(f"  [SKIP] offset {offset} failed after {HTTP_RETRIES} retries")
        failed_offsets.append(offset)
        offset += PAGE_SIZE
        # Safety valve: if we've accumulated many failures, bail
        if len(failed_offsets) >= 20:
            print(f"  [ABORT] 20+ failed offsets, stopping")
            break
        continue

    feats = page.get("features", [])
    if not feats:
        break
    written = upsert_features(feats)
    total += written
    elapsed = time.time() - t0
    rate = total / elapsed if elapsed > 0 else 0
    print(f"  page {page_num}: +{written}  (session total {total}, {rate:.0f}/sec, offset {offset})")
    if len(feats) < PAGE_SIZE:
        break
    offset += PAGE_SIZE

print(f"\n[OK] This session ingested {total} rows in {time.time()-t0:.1f}s")
if failed_offsets:
    print(f"[WARN] {len(failed_offsets)} offsets failed: {failed_offsets}")
    print(f"       Re-run the script — resume will pick up after gaps,")
    print(f"       or manually fetch these offsets with smaller PAGE_SIZE.")


# ── Post-load verification ──────────────────────────────
print("\n=== Verification ===")
with conn.cursor() as cur:
    cur.execute(f"SELECT COUNT(*) FROM {TABLE};")
    db_count = cur.fetchone()[0]
    print(f"{TABLE}: DB has {db_count} rows total")

    cur.execute(f"SELECT raw FROM {TABLE} LIMIT 1;")
    sample = cur.fetchone()
    if sample:
        keys = list(sample[0].keys())
        print(f"  sample row keys ({len(keys)}): {keys}")

conn.close()
print("\n[DONE]")
