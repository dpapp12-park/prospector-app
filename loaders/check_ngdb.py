"""
check_ngdb.py — verify NGDB ingest completeness.

Connects to Supabase via pooler (reads creds from .env), queries exact
row counts for every ngdb_* table, prints a clean summary with
expected-vs-actual for the known targets. Run from repo root:

    python check_ngdb.py
"""

import os
import sys
import psycopg2
from dotenv import load_dotenv

load_dotenv()

# Expected row counts. Rock values are confirmed complete (Session 18).
# Sed/Soil/Conc values are USGS source totals; loader may skip rows with
# invalid lat/lon or oversized text fields (~0.4% skip on rock was normal).
EXPECTED = {
    # ── Rock (complete per Session 18) ─────────────────────────
    "ngdb_rock_samples":       412_651,
    "ngdb_rock_major_chem":    167_937,
    "ngdb_rock_es_chem":       218_703,
    "ngdb_rock_icpaes_chem":   63_385,
    "ngdb_rock_icpms_chem":    5_846,
    "ngdb_rock_naa_chem":      55_622,
    "ngdb_rock_xrf_chem":      38_581,
    "ngdb_rock_other_chem":    192_339,
    "ngdb_rock_unknown_chem":  76_743,
    # ── Sediment (bestvalue + chemistry confirmed S18; main + datadxny were partial) ──
    "ngdb_sed_bestvalue":      10_567_162,
    "ngdb_sed_chemistry":      12_098_896,
    "ngdb_sed_main":           None,   # USGS source: ~400K, exact unknown
    "ngdb_sed_datadxny":       None,   # Likely empty lookup file
    # ── Soil (partial at end of S18; resume this run) ──────────
    "ngdb_soil_bestvalue":     None,
    "ngdb_soil_chemistry":     None,
    "ngdb_soil_main":          None,
    "ngdb_soil_datadxny":      None,
    # ── Concentrate (ran this session) ─────────────────────────
    "ngdb_conc_bestvalue":     None,
    "ngdb_conc_chemistry":     None,
    "ngdb_conc_main":          None,
    "ngdb_conc_datadxny":      None,
}


def connect():
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASS"],
    )


def main():
    try:
        conn = connect()
    except Exception as e:
        print(f"[ERR] Could not connect: {e}")
        sys.exit(1)

    cur = conn.cursor()

    # Get all ngdb_* tables that actually exist in the DB
    cur.execute("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name LIKE 'ngdb_%'
        ORDER BY table_name;
    """)
    existing = [row[0] for row in cur.fetchall()]

    if not existing:
        print("[WARN] No ngdb_* tables found in public schema.")
        conn.close()
        sys.exit(1)

    print(f"Found {len(existing)} ngdb_* tables. Counting rows (exact)...")
    print("-" * 78)
    print(f"{'Table':<28}{'Rows':>16}{'Expected':>16}{'Status':>18}")
    print("-" * 78)

    totals_by_group = {"rock": 0, "sed": 0, "soil": 0, "conc": 0}
    grand_total = 0

    for table in existing:
        cur.execute(f"SELECT COUNT(*) FROM {table};")
        actual = cur.fetchone()[0]
        grand_total += actual

        # Group totals
        for key in totals_by_group:
            if table.startswith(f"ngdb_{key}_"):
                totals_by_group[key] += actual
                break

        expected = EXPECTED.get(table)
        if expected is None:
            status = "—"
            exp_str = "—"
        elif actual == expected:
            status = "✓ match"
            exp_str = f"{expected:,}"
        elif actual > expected:
            status = f"+{actual - expected:,}"
            exp_str = f"{expected:,}"
        else:
            status = f"-{expected - actual:,}"
            exp_str = f"{expected:,}"

        print(f"{table:<28}{actual:>16,}{exp_str:>16}{status:>18}")

    print("-" * 78)
    for group, total in totals_by_group.items():
        if total > 0:
            print(f"  ngdb_{group}_* subtotal: {total:>15,} rows")
    print(f"  GRAND TOTAL:          {grand_total:>15,} rows")
    print("-" * 78)

    # Flag any empty tables (often real problems, sometimes lookup stubs)
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name LIKE 'ngdb_%'
        ORDER BY table_name;
    """)
    empties = []
    for (table,) in cur.fetchall():
        cur.execute(f"SELECT COUNT(*) FROM {table};")
        if cur.fetchone()[0] == 0:
            empties.append(table)

    if empties:
        print("\n[INFO] Empty tables (0 rows):")
        for t in empties:
            print(f"  - {t}")
        print("  (datadxny files are usually empty lookup stubs — not a problem.)")

    conn.close()
    print("\n[DONE]")


if __name__ == "__main__":
    main()
