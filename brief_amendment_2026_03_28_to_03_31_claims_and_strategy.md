# Brief Amendment - Claims Expansion + Strategy Session
## Dates: March 28-31, 2026
## Session type: Data pipeline build + infrastructure debugging + strategy/brainstorm

Append this block to the Session Log in `Prospector_Master_Brief_v4.md`.

---

## 1) Scope of Session

Primary objective was to rapidly expand BLM claims coverage across multiple states, stabilize the download/load workflow, and preserve strategic product/business direction discovered during extended brainstorming.

Secondary objective was to define a repeatable refresh process for claims updates and clarify near-term sequencing before Mapbox tileset rebuild.

---

## 2) Major Technical Outcomes

### A) Multi-state claims pipeline built and operational
- Built and iterated multiple scripts to handle BLM endpoint instability and schema differences.
- Introduced robust state range filtering based on `CSE_NR` prefix.
- Added Alaska-specific downloader against separate BLM AK service.
- Added dedicated fix script for AZ/SD/OR edge cases.
- Added load-only script for local GeoJSON -> Supabase to decouple download from load step.

### B) Supabase data integrity and performance protections applied
- Existing duplicate rows in claims tables were detected and cleaned.
- Unique constraints added on `cse_nr` to both:
  - `mining_claims_active`
  - `mining_claims_closed`
- Load strategy adjusted from update-heavy writes to insert-if-new:
  - switched to `ON CONFLICT DO NOTHING` behavior for faster reruns and safer resumes.

### C) Completed large-scale claims ingestion
- Achieved ~2.3M total claims loaded into Supabase (active + closed) across primary western states.
- Confirmed practical handling of interrupted/timeout-heavy runs by resumable reruns.
- Confirmed key edge cases:
  - WA separately returns zero in national pull; WA records are represented under OR office data in this workflow.
  - SD returns zero in BLM national claims endpoint for this pipeline (not necessarily no mining history; indicates this BLM source does not provide usable SD claims for this approach).

### D) Tooling/environment discoveries
- Node/npm installed successfully but old npm package path for Mapbox CLI was invalid.
- `mapbox-tilesets` Python package route blocked by Python 3.14 + numpy compatibility/build constraints on Windows.
- Final decision for next phase: use Mapbox Studio web uploads/chunk workflow instead of CLI for immediate execution.

---

## 3) Scripts Created/Refined During Session

All scripts referenced as existing in project workflow:

1. `download_claims.py`
   - Lower-48 state downloader.
   - Handles active + closed per state.
   - Uses `CSE_NR` range filtering strategy (not `LIKE`).

2. `download_alaska.py`
   - Alaska-only downloader.
   - Uses separate Alaska BLM server/endpoints.

3. `download_az_sd_or.py`
   - Targeted helper for AZ/SD/OR.
   - Includes AZ prefix edge-case handling (`Z` rollover logic issue fixed).
   - Includes SD diagnostics.

4. `update_claims.py`
   - Combined fetch + load/upsert-style maintenance script.
   - Intended for routine refresh operations.

5. `load_all_claims.py`
   - Load-only script from existing local GeoJSON files.
   - Designed for long unattended runs and resumable state subsets.
   - Evolved toward conflict skip behavior for speed/reliability.

---

## 4) Data Expansion Results (Session Record)

Session captured high-volume downloads/loads with occasional BLM/API interruptions and resumptions. Final accepted session posture:

- Core western states now represented with large-scale active + closed coverage.
- Arizona and Wyoming closed-claim volumes were significantly larger than initially expected (major historical mining signal).
- California, Nevada, and Idaho observed as susceptible to partial/cutoff behavior from BLM during some runs; reruns are expected to progressively fill.
- Alaska downloaded cleanly and consistently via separate endpoint.

Database totals used for planning after ingestion:
- Active claims: ~317,871
- Closed claims: ~1,967,503
- Grand total: ~2,285,374 (rounded to ~2.3M)

---

## 5) Critical Technical Learnings Logged

1. BLM endpoint instability is normal for this volume.
   - Timeouts/500s are expected and must be treated as operational reality.
   - Scripts must be resumable and safe to rerun.

2. Prefix-filter strategy is required.
   - `LIKE` queries caused server failures.
   - Range-based prefix logic is required for reliability.

3. Constraints before scale.
   - Unique key enforcement on `cse_nr` is mandatory before repetitive loads.

4. Separation of concerns improves reliability.
   - Download and load as separate steps for large data operations.

5. Windows/Python toolchain limits affect CLI choices.
   - Mapbox Studio web flow is practical and unblocked.

---

## 6) Product/Business Strategy Decisions Captured

### A) No-shortcuts quality mandate (explicit)
Session established explicit build standard:
- Do not optimize for quick hacks.
- Build for retirement-grade business quality.
- Frontend quality must match dataset quality.
- Use best available approach unless explicitly directed otherwise.

### B) Product principle adopted for all future sessions
Every feature should pass:
1. Would a beginner understand this?
2. Does this work in the field?
3. Is this good enough to retire on?

### C) User persona insight (high impact)
- Founder identified as beginner prospector.
- This is strategic, not a weakness.
- Product should intentionally optimize onboarding and interpretation for beginners while retaining depth for experts.

### D) Sequencing logic reinforced
- Data moat first, then polished interpretation UX, then monetization compounding.
- State coverage and historical context are core moat assets.

---

## 7) Brainstorm Capture (Revisit List - Do Not Lose)

The following were explicitly captured as revisit/backlog ideas, not commitments:

### High-value utility ideas
- Claim expiry calendar.
- Annual maintenance fee calculator.
- Staking cost estimator.
- "What's near me" radar tool.
- Print-ready PDF map exports.
- Claim monitoring alerts as sticky retention driver.

### Data/intelligence layer ideas
- Wildfire burn-area overlay for post-burn exposure targeting.
- Road conditions / seasonal access intelligence.
- Soil moisture/drought indices for planning.
- Historical weather context.
- Water rights overlays (future complexity).
- Satellite change detection (advanced).

### History moat ideas (major differentiation)
- Historic mining district boundaries layer.
- District narratives with production context.
- Timeline slider/animation across claims/mines eras.
- GLO records integration links.
- USGS bulletin/state mining report contextual references.
- Example concept captured: Cornucopia-style district storytelling and multi-era claim pattern interpretation.

### Community/retention ideas
- Seasonal field condition reports.
- Anonymous activity heat signatures.
- Guided routes.
- Milestone celebrations for first finds/lifetime progress.

### Revenue/market expansion ideas
- Data licensing for junior mining companies.
- Enterprise/API tiers.
- Club-oriented offerings and partnerships.
- Canada expansion explicitly parked for v2 (BC/Yukon first when pursued).

---

## 8) Frontend and UX Gaps Acknowledged

Despite strong data progress, session explicitly logged these product risks:
- Current frontend must evolve from layer toggles to true research/intelligence UX.
- Onboarding for beginners remains underdeveloped.
- Mobile-in-field ergonomics must be prioritized (sunlight, glove use, weak signal).
- Visual brand identity should become more distinct and premium.
- Information hierarchy in popups/panels must scale with richer data context.

---

## 9) Operational Update Strategy (Interim)

Interim operating model accepted:
- Run manual periodic refreshes (monthly baseline) using update/load scripts.
- Avoid fragile unattended cron-heavy automation until environment and reliability mature.
- Maintain rerunnable scripts with conflict-safe behavior.
- Continue gap-filling via reruns for large/unstable states.

---

## 10) Next-Step Handoff (Post Session)

1. Confirm all loaded counts in Supabase by state.
2. Export for Mapbox using chunk strategy that fits upload limits.
3. Rebuild active + closed tilesets in Mapbox Studio web flow.
4. Replace tileset IDs/source-layers in `index.html`.
5. Deploy and validate multi-state rendering in live app.
6. Then prioritize UI/UX intelligence and beginner-focused discovery flow improvements.

---

## 11) Suggested Commit Message (for this amendment file)

`Add Mar 28-31 claims pipeline and strategy amendment`

---
