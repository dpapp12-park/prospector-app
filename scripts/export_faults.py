"""
export_faults.py - Export quaternary_faults from Supabase to GeoJSON
for Mapbox Studio upload.

Session 19 - P1.18 - Quaternary Faults tileset wiring.

Layout (all relative to this script):
  scripts/export_faults.py          <-- this file
  scripts/mapbox_export/            <-- created automatically when this runs
    quaternary_faults.geojson       <-- the output
  ../.env                           <-- credentials (one folder up)
"""
import json
import os
import psycopg2
from dotenv import load_dotenv

# -- PATHS (all relative to the script) ----------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(SCRIPT_DIR, "..", ".env")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "mapbox_export")
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "quaternary_faults.geojson")

if not os.path.exists(ENV_PATH):
    raise FileNotFoundError(f".env not found at {ENV_PATH}")

os.makedirs(OUTPUT_DIR, exist_ok=True)  # creates scripts/mapbox_export/ if missing

# -- LOAD CREDENTIALS ----------------------------------------------------
load_dotenv(ENV_PATH)

DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_NAME = os.getenv("DB_NAME")
DB_USER = os.getenv("DB_USER")
DB_PASS = os.getenv("DB_PASS")

if not all([DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS]):
    raise RuntimeError("Missing one or more DB_* variables in .env")

# -- CONNECT -------------------------------------------------------------
print(f"Connecting to Supabase pooler at {DB_HOST} ...")
conn = psycopg2.connect(
    host=DB_HOST, dbname=DB_NAME, user=DB_USER,
    password=DB_PASS, port=DB_PORT
)
print("Connected.\n")

# -- EXPORT --------------------------------------------------------------
sql = """
    SELECT
        source_id,
        raw,
        ST_AsGeoJSON(geometry)::text AS geojson
    FROM quaternary_faults
    WHERE geometry IS NOT NULL
"""

print(f"Exporting quaternary_faults -> {OUTPUT_PATH}")
total = 0

with conn.cursor(name="cursor_faults") as cur:
    cur.itersize = 1000
    cur.execute(sql)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write('{"type":"FeatureCollection","features":[')
        first = True
        for row in cur:
            source_id, raw, geojson = row
            props = dict(raw) if raw else {}
            props["source_id"] = source_id
            feature = {
                "type": "Feature",
                "geometry": json.loads(geojson),
                "properties": props,
            }
            if not first:
                f.write(",")
            f.write(json.dumps(feature, default=str))
            first = False
            total += 1
            if total % 5000 == 0:
                print(f"  {total:,} records...", end="\r")
        f.write("]}")

conn.close()

size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
print(f"\nDone.")
print(f"  {total:,} features -> {OUTPUT_PATH}")
print(f"  file size: {size_mb:.1f} MB")
