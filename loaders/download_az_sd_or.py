"""
Prospector — Claims Downloader (AZ / SD / OR fix)
===================================================
Fixes:
- AZ: next char after 'Z' is '[' which breaks URLs. Fixed by jumping to next
  first letter instead (AZ -> B as upper bound).
- SD: diagnostic mode checks what prefixes exist near SD before downloading.
- OR: re-downloads from national endpoint for consistent field names.

Usage:
  python download_az_sd_or.py AZ       -- download Arizona
  python download_az_sd_or.py SD       -- run SD diagnostic then attempt download
  python download_az_sd_or.py OR       -- re-download Oregon from national endpoint
  python download_az_sd_or.py AZ SD OR -- all three

Requires: requests  (pip install requests)
"""

import sys
import json
import time
import os

try:
    import requests
except ImportError:
    print("ERROR: Run:  pip install requests")
    sys.exit(1)

# ── BLM API endpoints ─────────────────────────────────────────────────────────
ACTIVE_URL = "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/FeatureServer/0/query"
CLOSED_URL = "https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Closed/FeatureServer/0/query"

PAGE_SIZE = 1000
DOWNLOAD_DIR = os.path.dirname(os.path.abspath(__file__))


def log(msg):
    print(msg, flush=True)


def next_prefix(state):
    """
    Returns the upper bound prefix for a state's CSE_NR range query.
    
    Normal case:  'CA' -> 'CB'  (increment last letter)
    Z edge case:  'AZ' -> 'B'   (last letter is Z, increment first letter)
                  'NZ' -> 'O'
    
    This avoids the '[' character bug (ASCII 91, one after 'Z' = 90).
    '[' is a special character that breaks BLM's URL parser.
    """
    chars = list(state.upper())
    if chars[-1] == 'Z':
        # Can't increment last char — jump to next first letter
        return chr(ord(chars[0]) + 1) + '-'
    else:
        chars[-1] = chr(ord(chars[-1]) + 1)
        return "".join(chars) + '-'


def build_where(state):
    """Build the WHERE clause for a state query."""
    state = state.upper()
    lower = f"{state}-"
    upper = next_prefix(state)
    return f"CSE_NR >= '{lower}' AND CSE_NR < '{upper}'"


def fetch_page(url, where, offset):
    """Fetch a single page of results."""
    params = {
        "where": where,
        "outFields": "*",
        "f": "geojson",
        "resultOffset": offset,
        "resultRecordCount": PAGE_SIZE,
    }
    resp = requests.get(url, params=params, timeout=60)
    resp.raise_for_status()
    return resp.json().get("features", [])


def download_state(state, url, label):
    """Download all claims for a state."""
    state = state.upper()
    where = build_where(state)
    log(f"\n--- Downloading {label} claims for {state} ---")
    log(f"    WHERE: {where}")

    all_features = []
    offset = 0
    retries = 0

    while True:
        try:
            features = fetch_page(url, where, offset)
            retries = 0
        except requests.exceptions.RequestException as e:
            retries += 1
            log(f"  ERROR at offset {offset}: {e}")
            if retries >= 5:
                log("  Too many errors — stopping.")
                break
            log(f"  Retrying in 15s ({retries}/5)...")
            time.sleep(15)
            continue

        if not features:
            break

        all_features.extend(features)
        if len(all_features) % 5000 == 0 or len(features) < PAGE_SIZE:
            log(f"  {len(all_features):,} records so far...")

        if len(features) < PAGE_SIZE:
            break

        offset += PAGE_SIZE
        time.sleep(0.5)

    log(f"  Total: {len(all_features):,} {label} records for {state}")
    return all_features


def save_geojson(features, filepath):
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)
    mb = os.path.getsize(filepath) / 1024 / 1024
    log(f"  Saved: {filepath} ({mb:.1f} MB)")


# ── SD DIAGNOSTIC ─────────────────────────────────────────────────────────────

def diagnose_sd():
    """
    Check what CSE_NR prefixes exist around 'SD' in the BLM database.
    South Dakota returns 0 records with 'SD-' prefix — this investigates why.
    """
    log("\n--- SD Diagnostic ---")
    log("Checking what state prefixes exist near SD in BLM database...")

    # Sample a few records to see what prefixes are in use
    test_prefixes = ["SD", "SO", "SP", "SN"]

    for prefix in test_prefixes:
        try:
            where = f"CSE_NR >= '{prefix}-' AND CSE_NR < '{chr(ord(prefix[-1])+1)}-'" if prefix[-1] != 'Z' else f"CSE_NR >= '{prefix}-' AND CSE_NR < '{chr(ord(prefix[0])+1)}-'"
            params = {
                "where": where,
                "outFields": "CSE_NR",
                "f": "json",
                "resultRecordCount": 3,
                "returnCountOnly": "false"
            }
            resp = requests.get(ACTIVE_URL, params=params, timeout=30)
            data = resp.json()
            features = data.get("features", [])
            if features:
                sample = [f["attributes"].get("CSE_NR", "?") for f in features[:3]]
                log(f"  {prefix}: Found records! Sample: {sample}")
            else:
                log(f"  {prefix}: 0 records")
        except Exception as e:
            log(f"  {prefix}: Error — {e}")
        time.sleep(1)

    # Also try count-only query for SD
    log("\nChecking total count for SD- prefix...")
    try:
        params = {
            "where": "CSE_NR >= 'SD-' AND CSE_NR < 'SE-'",
            "returnCountOnly": "true",
            "f": "json"
        }
        resp = requests.get(ACTIVE_URL, params=params, timeout=30)
        data = resp.json()
        log(f"  Active count for SD-: {data.get('count', 'unknown')}")

        resp = requests.get(CLOSED_URL, params=params, timeout=30)
        data = resp.json()
        log(f"  Closed count for SD-: {data.get('count', 'unknown')}")
    except Exception as e:
        log(f"  Count query error: {e}")


# ── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: python download_az_sd_or.py AZ")
        print("       python download_az_sd_or.py AZ SD OR")
        sys.exit(1)

    states = [s.upper() for s in sys.argv[1:]]

    for state in states:

        if state == "SD":
            # Run diagnostic first, then attempt download
            diagnose_sd()
            log("\nAttempting SD download anyway...")

        log(f"\n{'='*50}")
        log(f"Processing {state}...")

        if state == "AZ":
            log(f"  Note: Using fixed prefix logic for AZ (avoids [ character bug)")
            log(f"  WHERE clause will be: {build_where('AZ')}")

        # Active claims
        active = download_state(state, ACTIVE_URL, "ACTIVE")
        active_path = os.path.join(DOWNLOAD_DIR, f"{state.lower()}_active.geojson")
        save_geojson(active, active_path)

        # Closed claims
        closed = download_state(state, CLOSED_URL, "CLOSED")
        closed_path = os.path.join(DOWNLOAD_DIR, f"{state.lower()}_closed.geojson")
        save_geojson(closed, closed_path)

        log(f"\n{state} complete:")
        log(f"  Active: {len(active):,} records -> {state.lower()}_active.geojson")
        log(f"  Closed: {len(closed):,} records -> {state.lower()}_closed.geojson")

    log("\n=== All done! ===")
    log("Next step: run load_all_claims.py to push into Supabase.")


if __name__ == "__main__":
    main()
