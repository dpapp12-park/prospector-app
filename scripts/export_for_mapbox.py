"""
Prospector — Mapbox Export (v2)
================================
Exports active mining claims from Supabase as line-delimited GeoJSON
for Mapbox tileset upload.

v2 CHANGE: Credentials moved from hardcoded to .env per [F-9].
Reads same .env file as load_all_claims.py (variable: DB_PASS).
No other behavior changed.

Requires (install once):
  pip install psycopg2-binary python-dotenv
"""

import json
import os
import sys

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

# ── CONFIG ───────────────────────────────────────────────────────────────────

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

OUTPUT_DIR = r"C:\Users\dpapp\OneDrive\Desktop\Projects\prospector-app\mapbox_export"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── CONNECT ──────────────────────────────────────────────────────────────────
print("Connecting to Supabase...")
conn = psycopg2.connect(
    host=DB_HOST, dbname=DB_NAME, user=DB_USER,
    password=DB_PASS, port=DB_PORT
)
print("Connected.\n")

# ── EXPORT FUNCTION ──────────────────────────────────────────────────────────
def export_table(table_name, output_filename, where_clause=""):
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    sql = f"""
        SELECT
            cse_nm, cse_nr, blm_prod, cse_disp, cse_disp_dt, cse_exp_dt, gis_acres, blm_org_cd,
            ST_AsGeoJSON(geometry)::text as geojson
        FROM {table_name}
        WHERE geometry IS NOT NULL
        {where_clause}
    """
    total = 0
    with conn.cursor(name=f"cursor_{output_filename}") as cur:
        cur.itersize = 1000
        cur.execute(sql)
        with open(output_path, "w") as f:
            for row in cur:
                cse_nm, cse_nr, blm_prod, cse_disp, cse_disp_dt, cse_exp_dt, gis_acres, blm_org_cd, geojson = row
                feature = {
                    "type": "Feature",
                    "geometry": json.loads(geojson),
                    "properties": {
                        "cse_nm": cse_nm,
                        "cse_nr": cse_nr,
                        "blm_prod": blm_prod,
                        "cse_disp": cse_disp,
                        "cse_disp_dt": cse_disp_dt,
                        "cse_exp_dt": cse_exp_dt,
                        "gis_acres": float(gis_acres) if gis_acres else None,
                        "blm_org_cd": blm_org_cd,
                    }
                }
                f.write(json.dumps(feature) + "\n")
                total += 1
                if total % 5000 == 0:
                    print(f"  {total:,} records...", end="\r")

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  {total:,} records → {output_filename} ({size_mb:.1f} MB)")

# ── ACTIVE CLAIMS ONLY ───────────────────────────────────────────────────────
print("Exporting active claims...")
export_table("mining_claims_active", "active_claims.geojsonl")

conn.close()
print("\nDone. File is in:", OUTPUT_DIR)
