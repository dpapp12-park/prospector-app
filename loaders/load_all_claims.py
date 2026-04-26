"""
Prospector — Claims Loader v4
=============================
Reads already-downloaded GeoJSON files and upserts them into Supabase.
Uses DO NOTHING on conflict — skips existing records instead of overwriting.
Faster and safer for re-runs.

v4 CHANGE: Credentials moved from hardcoded to .env per [F-9].
No secrets live in this file. Password is read from a .env file in
the same folder as this script.

HOW TO RUN:
  python load_all_claims.py
  python load_all_claims.py UT NV CA WY

Requires (install once):
  pip install psycopg2-binary python-dotenv
"""

import json
import os
import sys
import time
import datetime

try:
    import psycopg2
except ImportError:
    print("ERROR: Run:  pip install psycopg2-binary")
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    print("ERROR: Run:  pip install python-dotenv")
    sys.exit(1)

# ── LOAD .env FROM THIS SCRIPT'S FOLDER ──────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(SCRIPT_DIR, ".env"))

# ── CONFIG (from .env, with safe non-secret defaults) ────────────────────────

DB_HOST = os.getenv("DB_HOST", "db.condhfwpzlxrzuadgopc.supabase.co")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "postgres")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASS = os.getenv("DB_PASS")

if not DB_PASS:
    print("ERROR: DB_PASS not found.")
    print(f"Expected a .env file in: {SCRIPT_DIR}")
    print("Containing a line like:  DB_PASS=your-supabase-password")
    sys.exit(1)

DATA_DIR = SCRIPT_DIR
DEFAULT_STATES = ["NM", "MT", "CO", "ID", "UT", "NV", "CA", "WY"]
BATCH_SIZE = 100

# ── DATABASE ──────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT,
        dbname=DB_NAME, user=DB_USER, password=DB_PASS,
        connect_timeout=30,
        keepalives=1, keepalives_idle=30,
        keepalives_interval=10, keepalives_count=5
    )

def log(msg):
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

# ── INSERT SQL — DO NOTHING skips duplicates, faster than overwriting ─────────

INSERT_SQL = """
INSERT INTO {table} (
    cse_nm, cse_nr, leg_cse_nr,
    blm_prod, cse_disp, gis_acres, global_id, geometry
) VALUES (
    %s, %s, %s,
    %s, %s, %s, %s,
    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)
)
ON CONFLICT (cse_nr) DO NOTHING
"""

def get_prop(props, *keys):
    for key in keys:
        val = props.get(key)
        if val is not None:
            return val
    return None

# ── LOADER ────────────────────────────────────────────────────────────────────

def load_file(filepath, table):
    if not os.path.exists(filepath):
        log(f"  File not found, skipping: {filepath}")
        return 0

    size_mb = os.path.getsize(filepath) / 1024 / 1024
    if size_mb < 0.01:
        log(f"  Empty file, skipping: {os.path.basename(filepath)}")
        return 0

    log(f"  Loading {os.path.basename(filepath)} ({size_mb:.1f} MB) into {table}...")

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    total = len(features)

    if total == 0:
        log(f"  No features found, skipping.")
        return 0

    log(f"  {total:,} features to insert...")

    inserted = 0
    skipped = 0
    errors = 0

    conn = get_conn()
    cur = conn.cursor()

    for i, feature in enumerate(features):
        props = feature.get("properties", {}) or {}
        geom = feature.get("geometry")

        if not geom:
            skipped += 1
            continue

        try:
            cur.execute(INSERT_SQL.format(table=table), (
                get_prop(props, "CSE_NAME", "CSE_NM", "cse_nm"),
                get_prop(props, "CSE_NR", "cse_nr"),
                get_prop(props, "LEG_CSE_NR", "leg_cse_nr"),
                get_prop(props, "BLM_PROD", "blm_prod"),
                get_prop(props, "CSE_DISP", "cse_disp"),
                get_prop(props, "RCRD_ACRS", "GIS_ACRES", "gis_acres"),
                get_prop(props, "SF_ID", "GlobalID", "global_id"),
                json.dumps(geom)
            ))
            inserted += 1

            if inserted % BATCH_SIZE == 0:
                conn.commit()
                if inserted % 5000 == 0:
                    log(f"    {inserted:,} / {total:,} inserted...")

            if inserted % 500 == 0:
                conn.close()
                time.sleep(0.3)
                conn = get_conn()
                cur = conn.cursor()

        except Exception as e:
            errors += 1
            try:
                conn.rollback()
            except:
                pass
            try:
                conn = get_conn()
                cur = conn.cursor()
            except:
                pass
            if errors <= 3:
                log(f"  Error on record {i}: {e}")

    try:
        conn.commit()
        conn.close()
    except:
        pass

    log(f"  Done: {inserted:,} inserted, {skipped:,} skipped, {errors:,} errors")
    return inserted

# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    start = datetime.datetime.now()

    states = [s.upper() for s in sys.argv[1:]] if len(sys.argv) > 1 else DEFAULT_STATES

    log(f"=== Prospector Claims Loader v4 ===")
    log(f"Started: {start.strftime('%Y-%m-%d %H:%M')}")
    log(f"States: {', '.join(states)}")
    log(f"Mode: INSERT ... ON CONFLICT DO NOTHING (skips duplicates)")
    log("")

    total_inserted = 0

    for state in states:
        log(f"{'='*50}")
        log(f"Processing {state}...")
        state_lower = state.lower()

        n = load_file(os.path.join(DATA_DIR, f"{state_lower}_active.geojson"), "mining_claims_active")
        total_inserted += n

        n = load_file(os.path.join(DATA_DIR, f"{state_lower}_closed.geojson"), "mining_claims_closed")
        total_inserted += n

        log(f"{state} complete.")
        log("")

    elapsed = datetime.datetime.now() - start
    log(f"{'='*50}")
    log(f"All done!")
    log(f"Total records inserted: {total_inserted:,}")
    log(f"Total time: {str(elapsed).split('.')[0]}")

    with open(os.path.join(DATA_DIR, "load_log.txt"), "a") as f:
        f.write(f"\n{datetime.datetime.now().strftime('%Y-%m-%d %H:%M')} — "
                f"Loaded {states} — {total_inserted:,} records — "
                f"Time: {str(elapsed).split('.')[0]}\n")

    log("Log saved to load_log.txt")

if __name__ == "__main__":
    main()
