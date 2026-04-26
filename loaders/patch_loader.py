"""
patch_loader.py — one-shot fix for BOM-handling in load_ngdb.py.

Replaces `encoding="utf-8"` with `encoding="utf-8-sig"` in file opens,
so UTF-8 BOM on first column headers (present in soil CSVs) is stripped
before CSV reader parses the row. Idempotent — safe to re-run.
"""
from pathlib import Path

p = Path("load_ngdb.py")
if not p.exists():
    raise SystemExit("[FAIL] load_ngdb.py not found in current folder.")

text = p.read_text(encoding="utf-8")

if 'encoding="utf-8-sig"' in text:
    print("[OK] Already patched — no changes.")
else:
    new_text = text.replace('encoding="utf-8"', 'encoding="utf-8-sig"')
    n_changes = text.count('encoding="utf-8"') - new_text.count('encoding="utf-8"')
    p.write_text(new_text, encoding="utf-8")
    print(f"[OK] Patched load_ngdb.py — {n_changes} occurrence(s) of "
          f'encoding="utf-8" → encoding="utf-8-sig".')
