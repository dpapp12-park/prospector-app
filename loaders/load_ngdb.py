"""
load_ngdb.py
Unworked Gold — USGS National Geochemical Database loader.

Path A ingestion — mirror the source's 9-table relational structure.
One spine table per dataset (tblRockGeoData / tblSedGeoData / etc.)
plus one table per analytical chem method (xtbMajorChem, xtbXrfChem, etc.)

All tables keyed by LAB_ID (primary key in every USGS table).
"NULL" strings in source → real SQL NULLs.
Wide chem tables stored as JSONB in `raw` column per Data Foundation rule.

Run once per dataset folder. Specify folder + dataset prefix:
    python load_ngdb.py <folder> <prefix>

Examples (matching actual folder names on this machine):
    python load_ngdb.py .\GEOLOGY\ngdbrock-tab  ngdb_rock
    python load_ngdb.py .\GEOLOGY\ngdbsed-csv   ngdb_sed
    python load_ngdb.py .\GEOLOGY\ngdbsoil-csv  ngdb_soil
    python load_ngdb.py .\GEOLOGY\ngdbconc-csv  ngdb_conc

Handles both tab-delimited (.txt from rock) and CSV (.csv from sediment/soil).
Auto-detects delimiter per file.

Reads credentials from .env per F.9.
Resume-from-count baked in — rerun continues from where it stopped.
"""

import os
import sys
import csv
import time
import json
import psycopg2
from pathlib import Path
from psycopg2.extras import execute_values
from dotenv import load_dotenv

# ── CSV field size limit ───────────────────────────────
# USGS source has some text fields > 128KB default limit.
# Raise to max supported by platform.
csv.field_size_limit(sys.maxsize if sys.maxsize < 2**31 else 2**31 - 1)

# ── CLI args ───────────────────────────────────────────
if len(sys.argv) != 3:
    sys.exit("Usage: python load_ngdb.py <folder_path> <table_prefix>\n"
             "Example: python load_ngdb.py ./GEOLOGY/ngdbrock-tab ngdb_rock")

FOLDER = Path(sys.argv[1])
PREFIX = sys.argv[2].strip()

if not FOLDER.is_dir():
    sys.exit(f"[FAIL] Folder not found: {FOLDER}")
if not PREFIX:
    sys.exit("[FAIL] Prefix cannot be empty")

print(f"[OK] Source folder: {FOLDER}")
print(f"[OK] Table prefix:  {PREFIX}")


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


# ── File discovery ─────────────────────────────────────
# Find all data files in folder. Ignore .prj, .xml, other non-data.
VALID_EXT = {".txt", ".csv", ".tsv"}
data_files = sorted(
    f for f in FOLDER.iterdir()
    if f.is_file() and f.suffix.lower() in VALID_EXT
)
if not data_files:
    sys.exit(f"[FAIL] No .txt/.csv/.tsv files in {FOLDER}")

print(f"[OK] Found {len(data_files)} data files:")
for f in data_files:
    print(f"    {f.name} ({f.stat().st_size / 1024 / 1024:.1f} MB)")


# ── Delimiter detection ────────────────────────────────
def detect_delimiter(path):
    """Peek at file, return '\\t' or ','."""
    with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
        sample = f.read(4096)
    # Count tabs vs commas in first few lines
    tabs = sample.count("\t")
    commas = sample.count(",")
    return "\t" if tabs > commas else ","


# ── Table-name sanitization ─────────────────────────────
def table_name(prefix, filename):
    """
    Convert USGS source filename to Postgres table name.

    tblRockGeoData  → ngdb_rock_samples  (spine table always called "samples")
    xtbMajorChem    → ngdb_rock_major_chem
    xtbIcpmsChem    → ngdb_rock_icpms_chem
    """
    stem = Path(filename).stem  # no extension

    # Spine table: anything starting with "tbl"
    if stem.lower().startswith("tbl"):
        return f"{prefix}_samples"

    # Chem tables: "xtbMajorChem" → "major_chem"
    if stem.lower().startswith("xtb"):
        body = stem[3:]  # strip "xtb"
    else:
        body = stem

    # CamelCase → snake_case
    out = ""
    for i, ch in enumerate(body):
        if ch.isupper() and i > 0 and not body[i-1].isupper():
            out += "_"
        out += ch.lower()
    return f"{prefix}_{out}"


# ── Schema (idempotent, one table per file) ─────────────
DDL = """
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS {table} (
    id BIGSERIAL PRIMARY KEY,
    source_id TEXT NOT NULL UNIQUE,
    raw JSONB NOT NULL,
    geometry GEOMETRY(Point, 4326),
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_{table}_raw ON {table} USING GIN (raw);
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


def ensure_table(table):
    with conn.cursor() as cur:
        cur.execute(DDL.format(table=table))
    conn.commit()


def existing_count(table):
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM {table};")
        return cur.fetchone()[0]


# ── Row cleaning ───────────────────────────────────────
def find_field(row, *candidates):
    """
    Case-insensitive field lookup.
    Returns value for first matching column name, or None.
    """
    if not row:
        return None
    # Build once-per-call lowercase map
    lower_map = {k.lower(): k for k in row.keys() if k}
    for name in candidates:
        real = lower_map.get(name.lower())
        if real is not None:
            val = row.get(real)
            if val is not None:
                return val
    return None


def clean_row(row):
    """
    Source uses literal 'NULL' strings for missing values.
    Convert to real None. Strip whitespace.
    """
    cleaned = {}
    for k, v in row.items():
        if v is None:
            cleaned[k] = None
            continue
        v = v.strip()
        if v == "" or v.upper() == "NULL":
            cleaned[k] = None
        else:
            cleaned[k] = v
    return cleaned


def parse_lat_lon(row):
    """
    Spine tables have lat/lon in various column names across datasets:
    - rock: LATITUDE, LONGITUDE
    - sediment: lat_wgs84, long_wgs84 (also lat_orig, long_orig as fallback)
    Returns (lat, lon) or (None, None).
    """
    lat = find_field(row, "LATITUDE", "lat_wgs84", "latitude", "lat_orig")
    lon = find_field(row, "LONGITUDE", "long_wgs84", "longitude", "long_orig")
    if lat is None or lon is None:
        return None, None
    try:
        lat_f = float(lat)
        lon_f = float(lon)
        # sanity check — catch typos
        if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
            return None, None
        return lat_f, lon_f
    except (ValueError, TypeError):
        return None, None


# ── UPSERT a batch ──────────────────────────────────────
UPSERT_SQL = """
INSERT INTO {table} (source_id, raw, geometry)
VALUES %s
ON CONFLICT (source_id) DO UPDATE SET
    raw = EXCLUDED.raw,
    geometry = EXCLUDED.geometry,
    ingested_at = NOW();
"""


def upsert_batch(table, batch):
    if not batch:
        return 0
    rows = []
    seen = set()
    for row in batch:
        # Primary key lookup in priority order:
        # 1. rec_id — exists in sed/soil/conc long-format tables (unique per row)
        # 2. lab_id / LAB_ID — rock's wide-format tables, and sediment's main.csv
        sid = find_field(row, "rec_id", "LAB_ID", "lab_id")
        if not sid:
            continue
        sid = str(sid)
        if sid in seen:
            continue  # dedupe within batch
        seen.add(sid)
        lat, lon = parse_lat_lon(row)
        if lat is not None and lon is not None:
            geom = f"SRID=4326;POINT({lon} {lat})"
        else:
            geom = None
        rows.append((sid, json.dumps(row), geom))

    if not rows:
        return 0

    with conn.cursor() as cur:
        execute_values(
            cur,
            UPSERT_SQL.format(table=table),
            rows,
            template="(%s, %s::jsonb, ST_GeomFromText(%s))",
            page_size=500,
        )
    conn.commit()
    return len(rows)


# ── File ingestion ─────────────────────────────────────
BATCH_SIZE = 1000


def ingest_file(path, table):
    ensure_table(table)
    already = existing_count(table)

    delim = detect_delimiter(path)
    delim_name = "TAB" if delim == "\t" else "CSV"
    print(f"\n=== {path.name}  →  {table}")
    print(f"    delimiter: {delim_name}")
    print(f"    already in DB: {already}")

    t0 = time.time()
    total_seen = 0
    total_written = 0
    batch = []

    # Skip existing — read through source counting to `already`, then start ingesting
    with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        reader = csv.DictReader(f, delimiter=delim)
        for row in reader:
            total_seen += 1
            if total_seen <= already:
                continue
            batch.append(clean_row(row))
            if len(batch) >= BATCH_SIZE:
                written = upsert_batch(table, batch)
                total_written += written
                batch = []
                elapsed = time.time() - t0
                rate = total_written / elapsed if elapsed > 0 else 0
                print(f"    +{written}  (this run {total_written}, "
                      f"{rate:.0f}/sec, seen {total_seen})")

        if batch:
            written = upsert_batch(table, batch)
            total_written += written
            print(f"    +{written}  (final batch, this run {total_written})")

    final = existing_count(table)
    print(f"[OK] {table}: DB has {final} rows "
          f"(this run +{total_written}, {time.time()-t0:.1f}s)")
    return total_written, final


# ── Main ───────────────────────────────────────────────
results = {}
for f in data_files:
    table = table_name(PREFIX, f.name)
    try:
        written, final = ingest_file(f, table)
        results[table] = (written, final)
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] {f.name}: {e}")
        results[table] = (0, -1)


# ── Verification ───────────────────────────────────────
print("\n=== Verification ===")
grand_total = 0
for table, (written, final) in results.items():
    if final < 0:
        print(f"{table}: ERROR")
        continue
    grand_total += final
    print(f"{table}: {final} rows  (this run +{written})")

print(f"\n[TOTAL] {PREFIX}: {grand_total} rows")
conn.close()
print("[DONE]")
