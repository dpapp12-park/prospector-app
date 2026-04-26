"""
BLM Alaska Mining Claims Downloader
=====================================
Alaska uses a completely separate BLM server from the lower 48 states.
This script downloads active and closed federal mining claims for Alaska
and saves them as GeoJSON files ready for load into Supabase.

Usage:
  python download_alaska.py

Requires: requests  (pip install requests)
"""

import json
import os
import sys
import time
import datetime

try:
    import requests
except ImportError:
    print("ERROR: Run:  pip install requests")
    sys.exit(1)

# ── Alaska-specific BLM endpoints (completely separate from lower 48) ─────────
AK_ACTIVE_URL = "https://gis.blm.gov/akarcgis/rest/services/Minerals/BLM_AK_Federal_Mining_Claims/FeatureServer/0/query"
AK_CLOSED_URL = "https://gis.blm.gov/akarcgis/rest/services/Minerals/BLM_AK_Federal_Mining_Claims/FeatureServer/1/query"

PAGE_SIZE = 1000
DOWNLOAD_DIR = os.path.dirname(os.path.abspath(__file__))


def log(msg):
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


def download_alaska(url, label):
    """Download all Alaska claims from a given endpoint."""
    log(f"Downloading Alaska {label} claims...")

    all_features = []
    offset = 0
    retries = 0

    while True:
        params = {
            "where": "1=1",          # no state filter needed — Alaska only
            "outFields": "*",
            "f": "geojson",
            "resultOffset": offset,
            "resultRecordCount": PAGE_SIZE,
        }

        try:
            resp = requests.get(url, params=params, timeout=60)
            resp.raise_for_status()
            retries = 0
        except requests.exceptions.RequestException as e:
            retries += 1
            log(f"  Network error at offset {offset}: {e}")
            if retries >= 5:
                log("  Too many errors — stopping.")
                break
            log(f"  Retrying in 15s ({retries}/5)...")
            time.sleep(15)
            continue

        try:
            data = resp.json()
        except Exception as e:
            retries += 1
            log(f"  JSON parse error: {e}")
            if retries >= 5:
                break
            time.sleep(15)
            continue

        features = data.get("features", [])
        if not features:
            break

        all_features.extend(features)
        log(f"  {len(all_features)} records so far...")

        if len(features) < PAGE_SIZE:
            break

        offset += PAGE_SIZE
        time.sleep(0.5)

    log(f"  Total: {len(all_features)} Alaska {label} records downloaded.")
    return all_features


def save_geojson(features, filepath):
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)
    mb = os.path.getsize(filepath) / 1024 / 1024
    log(f"  Saved: {filepath} ({mb:.1f} MB)")


def main():
    log("=== Alaska Claims Downloader ===")
    log("Note: Alaska uses a separate BLM server from the lower 48 states.")

    # Active claims
    active = download_alaska(AK_ACTIVE_URL, "ACTIVE")
    active_path = os.path.join(DOWNLOAD_DIR, "ak_active.geojson")
    save_geojson(active, active_path)

    # Closed claims
    closed = download_alaska(AK_CLOSED_URL, "CLOSED")
    closed_path = os.path.join(DOWNLOAD_DIR, "ak_closed.geojson")
    save_geojson(closed, closed_path)

    log("\n=== Done! ===")
    log(f"Active: {len(active):,} records -> ak_active.geojson")
    log(f"Closed: {len(closed):,} records -> ak_closed.geojson")
    log("Next step: run update_claims.py or load_claims.py to push into Supabase.")


if __name__ == "__main__":
    main()
