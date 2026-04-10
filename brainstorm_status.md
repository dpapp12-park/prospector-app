# Brainstorm Status Tracker

Use this tracker for brainstorm decisions. Each idea should include enough detail to still make sense months later.
Fast-capture rule: capture thoughts quickly first, then organize them into this file afterward.

## Entry Template (use for each idea)

- Idea:
- Goal:
- Method:
- Output:
- Status: ToDo | Nixed | Undecided/Deferred
- Reason:
- Date logged:
- Source context:
- Next discussion trigger:

## Fast Capture Rule

- If an idea is incomplete or messy, log it immediately as a draft in `brainstorm_log.md`.
- Then convert it into a structured entry here with Status + Reason.
- Nothing gets dropped, even if wording is rough.

---

## ToDo (Decided YES)

### 1) Missed Ground Finder
- Idea: Identify likely under-worked pockets near old/unclaimed mines.
- Goal: Help users focus on ground most likely skipped by prior operators.
- Method: Combine historic mining intensity (closed claims + mine sites), geomorphology (LiDAR slope/relief), accessibility constraints (water/roads/slope), and current claim status.
- Output: Ranked polygons with labels such as High Potential, Medium, and Avoid.
- Status: ToDo
- Reason: Decided yes because it is a strong fit for the core use case and can leverage existing claims, mine layers, and LiDAR overlays already in the product.
- Date logged: 2026-04-10T04:10:27Z
- Source context: Brainstorm chat recap example provided by user.
- Next discussion trigger: Define v1 scoring inputs and confidence rules before implementation.

### 2) Expand AI with map/LiDAR visual analysis
- Idea: Broaden dashboard/map AI to detect tailings piles, dig sites, hidden disturbed ground, mined vs likely-virgin zones, and missed pockets around old unclaimed mines.
- Goal: Turn static overlays into actionable AI-assisted prospecting targets.
- Method: Extend current AI analysis flow with terrain + claim-history + mine-context features.
- Output: Explainable map overlays, confidence-ranked zones, and field-oriented guidance.
- Status: ToDo
- Reason: Decided yes because this is the umbrella direction and aligns with existing architecture.
- Date logged: 2026-04-09T07:19:56Z
- Source context: Brainstorm log entry.
- Next discussion trigger: Prioritize which sub-feature becomes v1.

## Nixed (Decided NO)

_None yet._

## Undecided / Deferred (Not decided or put off)

### 1) Tailings & Workings Detector
- Idea: Detect tailings piles, cuts, benches, adits, and disturbed ground from LiDAR + imagery.
- Goal: Surface likely legacy workings that are hard to see in raw basemap views.
- Method: Model on LiDAR + imagery tile patches to classify disturbance signatures.
- Output: Map overlay with confidence and explanation ("why flagged").
- Status: Undecided/Deferred
- Reason: Useful, but deferred until v1 rules-based approach is validated and feedback labels exist.
- Date logged: 2026-04-10T04:10:27Z
- Source context: Brainstorm alternatives list.
- Next discussion trigger: After first feedback cycle on Missed Ground Finder.

### 2) Virgin vs Mined Probability Surface
- Idea: Score each grid cell as likely mined historically vs likely untouched.
- Goal: Provide a fast visual screening layer for target selection.
- Method: Hybrid of distance-to-workings, claim history density, terrain signatures, and known indicator context.
- Output: Heatmap with confidence and uncertainty mask.
- Status: Undecided/Deferred
- Reason: Deferred until scoring and calibration strategy are agreed.
- Date logged: 2026-04-10T04:10:27Z
- Source context: Brainstorm alternatives list.
- Next discussion trigger: When we define calibration data and acceptable false-positive rate.

### 3) Claim Audit Assistant
- Idea: On click of an old unclaimed mine, AI returns likely worked zones, likely skipped zones, tailings rework targets, and suggested first-pass field route.
- Goal: Convert raw data into practical field decisions.
- Method: Assistant layer that summarizes outputs from scoring/detection systems.
- Output: Structured audit card tied to selected mine/claim context.
- Status: Undecided/Deferred
- Reason: Deferred because it depends on upstream quality from detection/scoring layers.
- Date logged: 2026-04-10T04:10:27Z
- Source context: Brainstorm alternatives list.
- Next discussion trigger: After baseline scoring outputs are trustworthy.

### 4) Exact scoring weights for mined vs likely-virgin classification
- Idea: Specify numeric feature weights and thresholds.
- Goal: Produce transparent and tunable rankings.
- Method: Weighted rule-based model with confidence calibration.
- Output: Versioned scoring rubric.
- Status: Undecided/Deferred
- Reason: Deferred until final v1 feature set is locked.
- Date logged: 2026-04-10T04:10:27Z
- Source context: Prior brainstorm notes.
- Next discussion trigger: Right before v1 implementation.

### 5) ML-first detector as the first release
- Idea: Launch with a trained model first, before rules-based baseline.
- Goal: Maximize pattern detection from day one.
- Method: Supervised model pipeline as initial release.
- Output: Direct ML inference overlays.
- Status: Undecided/Deferred
- Reason: Deferred because rules-first is lower risk, more explainable, and faster to validate.
- Date logged: 2026-04-10T04:10:27Z
- Source context: Prior brainstorm notes.
- Next discussion trigger: After collecting human validation labels from v1.
