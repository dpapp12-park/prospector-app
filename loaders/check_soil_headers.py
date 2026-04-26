"""
check_soil_headers.py — dump column headers + first row of every soil CSV.
Purpose: identify correct primary key column for soil ingest.
"""
import csv
import sys
from pathlib import Path

csv.field_size_limit(2**31 - 1)

FOLDER = Path(r"C:\Users\dpapp\Desktop\Projects\prospector-app\GEOLOGY\ngdbsoil-csv\ngdbsoil")

for path in sorted(FOLDER.glob("*.csv")):
    print(f"\n=== {path.name} ({path.stat().st_size / 1024 / 1024:.1f} MB) ===")
    try:
        with open(path, "r", encoding="utf-8", errors="replace", newline="") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if not header:
                print("  (empty file)")
                continue
            print(f"COLUMNS ({len(header)}):")
            for i, col in enumerate(header):
                print(f"  [{i}] {col}")
            row1 = next(reader, None)
            if row1:
                print(f"ROW 1 VALUES:")
                for col, val in zip(header, row1):
                    v = (val or "")[:60]
                    print(f"  {col}: {v}")
    except Exception as e:
        print(f"  [ERR] {e}")
