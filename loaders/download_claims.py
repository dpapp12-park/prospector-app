"""
BLM Mining Claims Downloader v3
Downloads active (not-closed) and closed mining claims for any US state.
Saves results as GeoJSON files ready for load_claims.py

Usage:
  python download_claims.py CA
  python download_claims.py CA ID NV WA

Requires: requests  (pip install requests)
"""

import sys
import json
import time
import os

try:
    import requests
except ImportError:
    print("ERROR: 'requests' library not found.")
    print("Run this first:  pip install requests")
    sys.exit(1)

# --- BLM API endpoints ---
ACTIVE_URL = "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/FeatureServer/0/query"
CLOSED_URL = "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Closed/FeatureServer/0/query"

PAGE_SIZE = 1000


def next_state_prefix(state_abbr):
    """Returns the next alphabetical prefix after the state code.
    e.g. 'CA' -> 'CB', 'NV' -> 'NW', 'WA' -> 'WB'
    Used for range query: CSE_NR >= 'CA-' AND CSE_NR < 'CB-'
    """
    prefix = list(state_abbr.upper())
    prefix[-1] = chr(ord(prefix[-1]) + 1)
    return "".join(prefix)


def download_state(state_abbr, url, label):
    """Download all claims for a state using CSE_NR range filter."""
    state_abbr = state_abbr.upper()
    next_prefix = next_state_prefix(state_abbr)
    print(f"\n--- Downloading {label} claims for {state_abbr} ---")

    # Range query: gets all records where CSE_NR starts with "CA-"
    where_clause = f"CSE_NR >= '{state_abbr}-' AND CSE_NR < '{next_prefix}-'"

    all_features = []
    offset = 0
    retries = 0

    while True:
        params = {
            "where": where_clause,
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
            print(f"  ERROR at offset {offset}: {e}")
            if retries >= 5:
                print("  Too many errors, stopping this dataset.")
                break
            print(f"  Retrying in 15 seconds... (attempt {retries}/5)")
            time.sleep(15)
            continue

        try:
            data = resp.json()
        except Exception as e:
            retries += 1
            print(f"  ERROR parsing JSON: {e}")
            if retries >= 5:
                break
            time.sleep(15)
            continue

        features = data.get("features", [])

        if not features:
            break

        all_features.extend(features)
        print(f"  Fetched {len(all_features)} records so far...")

        if len(features) < PAGE_SIZE:
            break

        offset += PAGE_SIZE
        time.sleep(0.5)

    print(f"  Total: {len(all_features)} records downloaded.")
    return all_features


def save_geojson(features, filename):
    geojson = {
        "type": "FeatureCollection",
        "features": features
    }
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(geojson, f)
    size_mb = os.path.getsize(filename) / (1024 * 1024)
    print(f"  Saved: {filename}  ({size_mb:.1f} MB)")


def main():
    if len(sys.argv) < 2:
        print("Usage: python download_claims.py CA")
        print("       python download_claims.py CA ID NV WA")
        sys.exit(1)

    states = [s.upper() for s in sys.argv[1:]]

    for state in states:
        active_features = download_state(state, ACTIVE_URL, "ACTIVE")
        active_file = f"{state.lower()}_active.geojson"
        save_geojson(active_features, active_file)

        closed_features = download_state(state, CLOSED_URL, "CLOSED")
        closed_file = f"{state.lower()}_closed.geojson"
        save_geojson(closed_features, closed_file)

        print(f"\n{state} complete: {active_file} and {closed_file}")

    print("\n=== All done! ===")
    print("Files saved in your current folder.")
    print("Next step: run load_claims.py to push them into Supabase.")


if __name__ == "__main__":
    main()
