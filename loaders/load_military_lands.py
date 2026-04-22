"""
load_military_lands.py

Reads mirta.geojson and upserts into military_lands.
source_id = OBJECTID (server-guaranteed unique integer, cast to TEXT).
"""

import json
import os

import psycopg2
from dotenv import load_dotenv

GEOJSON_FILE = "mirta.geojson"
TABLE_NAME = "military_lands"


def main():
    with open(GEOJSON_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    features = data.get("features") or []
    print(f"[read] {len(features)} features")

    # Sanity: OBJECTID populated + unique?
    oids = [(f.get("properties") or {}).get("OBJECTID") for f in features]
    if any(o is None for o in oids):
        print("[abort] some features missing OBJECTID"); return
    if len(set(oids)) != len(oids):
        print("[abort] OBJECTID not unique"); return
    print(f"[pre-check] OBJECTID ok across all {len(features)} features")

    load_dotenv()
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT")),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASS"),
    )
    conn.autocommit = False

    sql = f"""
        INSERT INTO {TABLE_NAME} (source_id, raw, geometry)
        VALUES (%s, %s::jsonb, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
        ON CONFLICT (source_id) DO UPDATE SET
            raw = EXCLUDED.raw,
            geometry = EXCLUDED.geometry,
            ingested_at = NOW()
        RETURNING (xmax = 0) AS inserted;
    """

    inserted = updated = skipped_no_geom = 0
    try:
        with conn.cursor() as cur:
            for i, feat in enumerate(features, start=1):
                props = feat.get("properties") or {}
                sid = str(props.get("OBJECTID"))
                geom = feat.get("geometry")
                if geom is None:
                    skipped_no_geom += 1
                    continue
                cur.execute(sql, (sid, json.dumps(props), json.dumps(geom)))
                if cur.fetchone()[0]:
                    inserted += 1
                else:
                    updated += 1
                if i % 100 == 0:
                    print(f"[upsert] {i}/{len(features)}")
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    print(f"[upsert] inserted={inserted} updated={updated} skipped_no_geom={skipped_no_geom}")

    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM {TABLE_NAME};")
        print(f"[totals] rows: {cur.fetchone()[0]}")
        cur.execute(
            f"SELECT source_id, jsonb_pretty(raw), ST_GeometryType(geometry), ST_SRID(geometry), ingested_at "
            f"FROM {TABLE_NAME} ORDER BY id LIMIT 1;"
        )
        row = cur.fetchone()
        if row:
            sid, pretty, gtype, srid, ts = row
            print(f"\n[sample] source_id={sid} geom={gtype} srid={srid} at={ts}")
            for line in pretty.splitlines():
                print(f"  {line}")
    conn.close()
    print("[done]")


if __name__ == "__main__":
    main()
