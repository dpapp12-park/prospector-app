# Unworked Gold / Prospector - Memory Backbone
## Date: April 9, 2026
## Purpose
Single-file continuity reference so new chats do not lose state. Use this as the first paste in new build/planning sessions together with the latest master brief and target file(s).

---

## 1) Confirmed Completed (from captured amendments)

### A) Claims data pipeline and ingestion (Mar 28-31 capture)
- Multi-state claims workflow built and operational across primary western states.
- Download+load tooling set established with state-specific handling and resumable reruns.
- Reliability strategy established for unstable BLM endpoints (timeouts/500s expected).
- Uniqueness/data-integrity protections applied (`cse_nr` uniqueness and conflict-safe load behavior).
- Large-scale load milestone reached (~2.3M active+closed claims combined).
- Working script set captured:
  - `download_claims.py`
  - `download_alaska.py`
  - `download_az_sd_or.py`
  - `update_claims.py`
  - `load_all_claims.py`

### B) Admin/analytics schema + planning locked (Apr 7 capture)
- Super-admin architecture decisions captured (7-tab admin structure).
- Notifications model decisions captured (broadcast/targeted, permanent/timed/persistent, templates, preview/draft/schedule).
- Analytics model decisions captured (first-party Supabase event ownership, 90-day semi-purge, monthly rollups).
- AI credits/limits direction captured (limits configurable, paid top-ups planned).
- Supabase tables recorded as created in that session:
  - `admin_users`, `ai_cost_log`, `ai_credits`, `notification_templates`, `notifications`,
    `notification_reads`, `sessions`, `map_events`, `feature_events`, `error_log`,
    `analytics_summaries`
- Admin UUID insertion captured: `beb4131b-b511-4acb-b565-d39a8858ade1`.

### C) Dashboard profile/alerts outcomes captured (Apr 7 capture)
- Two-column profile layout direction implemented and documented.
- Tabbed edit sections documented (Identity / Location / Preferences).
- Home-state/prospect-state handling expansion documented.
- Claim alert preference model documented in profile strategy.

### D) Memory reconciliation safeguards added (Apr 9 capture)
- Final Claude memory dump normalized and conflict-guardrailed.
- Explicit rule added: do not let older snapshots overwrite newer Apr 7-9 decisions unless re-approved.

---

## 2) Current TODO (working queue)

### Highest-priority implementation queue (carry-forward)
1. Build/finish auth path (Google + email/password with "explore first, login on save").
2. Landing page implementation.
3. Stripe integration (subscription + one-time top-up flow details).
4. Admin UI implementation at `admin/index.html` using already-created schema.
5. Dashboard additions:
   - "My Activity" tab
   - Gold Bank calculator
   - Profile image upload (requires Supabase Storage setup)
6. Analytics wiring in app runtime:
   - event writes for sessions/map/feature usage
   - consent gate before tracking
   - privacy policy page

### Data/infra TODO carry-forward
- Continue gap-fill reruns for states with partial/cutoff behavior.
- Complete claims export/tileset refresh loop and verify live rendering.
- Keep monthly rerunnable refresh discipline until fully automated ops are ready.

### LiDAR TODO (status: strategic decisions captured, implementation continuation required)
- Keep latest pipeline decision path from newer Apr 7-9 records as canonical.
- Continue with approved style/coverage rollout order and state-by-state validation.
- Preserve algorithm/output decisions already locked in newer updates; avoid regression to older intermediate snapshots.

---

## 3) Unexplored / Lost Brainstorms (do-not-lose pool)

### Utility + retention ideas
- Claim expiry calendar.
- Annual maintenance fee calculator.
- Staking cost estimator.
- "What's near me" radar.
- Print-ready map/PDF exports.
- Seasonal field-condition reporting.
- Anonymous activity heat signatures.
- Guided routes.
- Milestone celebration mechanics for finds/progress.

### Intelligence/data moat ideas
- Wildfire burn-area overlay.
- Road/seasonal access intelligence.
- Soil moisture/drought overlays.
- Historical weather context.
- Water-rights overlays (complex).
- Satellite change detection.
- Stream gradient analysis.
- Dredge-tailings detection from LiDAR.
- Bedrock depth context.
- Hydrothermal spring locations.
- Geobotany/vegetation anomaly signals.
- GLO field-note linkage by PLSS context.
- Seasonal water-level forecasting from historical gauges.

### History moat ideas
- Historic mining district boundaries.
- District narrative cards with production context.
- Timeline slider/animation across eras.
- GLO/USGS historical reference linking.

### Market/revenue expansion ideas
- Club-oriented offerings/partnership packaging.
- Data licensing + enterprise/API tiers.
- Future regional expansion paths (e.g., Canada v2 sequencing).

---

## 4) Locked Principles (keep in every future session)
- Beginner-first clarity is a core competitive moat.
- Field usability beats feature count.
- "Best of the best, no shortcuts."
- Research/options/tradeoffs before committing major architecture decisions.
- Preserve chronology: newer decisions override older snapshots unless explicitly reopened.

---

## 5) Conflicts to watch (memory safety rails)
- Name history conflict exists across old notes; keep current approved branding unless intentionally revisited.
- LiDAR algorithm notes evolved across sessions; keep latest approved pipeline decisions as canonical.
- Older version markers and pre-CDN/pre-domain infra snapshots are historical only.

---

## 6) How to use this file
At the start of a new chat:
1. Paste this memory backbone.
2. Paste latest master brief.
3. Paste current file(s) to edit.
4. State one concrete session goal.
5. End session with amendment + commit message + what changed.

