# Brief Amendment - LiDAR Source Verification Before AWS Processing
## Date: April 9, 2026
## Session type: Planning/verification (no pipeline build yet)

Append this block to the Session Log in `Prospector_Master_Brief_v4.md` (or current renamed master brief).

---

## 1) Session goal (confirmed)
- Verify the currently wired LiDAR source before starting/continuing AWS-side LiDAR processing.

---

## 2) Completed in this session

### A) AGENTS startup protocol execution
- Read `AGENTS.md`.
- Read `project_memory_backbone_2026_04_09.md`.
- Read current `brief_amendment_*.md` files for chronology and conflict guardrails.

### B) Source-of-truth LiDAR wiring check (app code)
- Confirmed LiDAR tiles are sourced from:
  - `https://tiles.unworkedgold.com` (R2/Cdn endpoint constant in map setup).
- Confirmed "Pendleton" multi-style LiDAR path is currently hardcoded as:
  - `/indiana/pendleton/<style>/{z}/{x}/{y}.webp`
- Confirmed legacy Oregon region is separately wired as:
  - `/oregon/sw-gold-belt/{z}/{x}/{y}.png`
- Confirmed LiDAR style picker affects only the Pendleton layer family (`hillshade/svf/slope/lrm/rrim/...`) while legacy regions are single-style hillshade.

### C) Runtime access note
- Direct server-side tile fetch attempts from this cloud VM returned HTTP 403 for the LiDAR tile URLs, so this session used repository wiring as the verification source of truth.

---

## 3) Current TODO (carry-forward)
1. Confirm intended AOI for "Pendleton" in canonical infra notes (Oregon vs Indiana).
2. On the AWS processing host, validate object prefixes actually present for the intended AOI/style outputs.
3. If intended AOI is Oregon, update app path wiring from `indiana/pendleton/...` to the correct Oregon prefix after bucket/path confirmation.
4. Run one AOI smoke test after path confirmation:
   - turn on LiDAR,
   - cycle style picker,
   - verify all style tiles render for the intended Pendleton AOI.

---

## 4) Unexplored / parked ideas (do-not-lose)
- Add a small "LiDAR source manifest" JSON + startup validator script so app wiring and AWS output prefixes cannot drift.

---

## 5) Suggested commit message
`Add Apr 9 LiDAR source verification amendment`

---
