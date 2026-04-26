# LAYERS_SCHEMA.md

**Purpose:** Schema design for `layers.json` + behavior-as-JS architecture per Session 23 `[C-11.5]`.

**Status:** Decisions Q1–Q9 + R1–R5 from Session 25 are baked in. This doc reflects the final-call schema, not the pre-decision proposal.

**Companion files:**
- `layers.json` — schema instance (all 51 cards)
- `LAYER_ROSTER.md` — per-tile inventory, statistics, audit notes
- `app-layer-loader.js` — JS loader that consumes `layers.json`

**Cross-refs:** `[C-11.1]` categories · `[C-11.2]` card design · `[C-11.3]` modal · `[C-11.4]` persistence · `[C-11.5]` architecture · `[D-11]` Learning by Doing.

---

## 1 — Top-level shape

```json
{
  "schemaVersion": 1,
  "categories": [ ... ],
  "layers": [ ... ]
}
```

Two arrays. `categories` is the tile/rail data. `layers` is the card data. They join via `layers[].categoryId`. Layers are top-level (not nested under categories) so that `pairsWith` references can read naturally and validation is simpler.

---

## 2 — Category schema

```json
{
  "id": "lidar",
  "label": "LiDAR",
  "iconKey": "lidar",
  "defaultRail": "left",
  "subSections": [
    { "id": "hillshade", "label": "LiDAR Hillshade" },
    { "id": "terrain-tools", "label": "Terrain Tools" }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | ✓ | Snake-case. Stable. |
| `label` | ✓ | Display name. |
| `iconKey` | ✓ | References `ICONS` dict in JS (SVG strings stay in JS, not JSON). |
| `defaultRail` | ✓ | `"top"` or `"left"`. Initial placement. User drag overrides via persisted layout. |
| `subSections` | optional | Array. Only present when ≥6 cards (per `[C-11.3]`) or design demands explicit grouping. |

**The 9 categories per `[C-11.1]`** (10 in schema — Indicators may sub-split into Geochemistry when NGDB ships, currently expressed as `subSections` instead):

| Top rail | Left rail |
|---|---|
| `historic-gold` | `land-access` |
| `indicators` | `roads-trails` |
| `geology` | `protected` |
| `active-claims` | `water` |
| `prospects` | `lidar` |

Only **two** categories have explicit sub-sections in the schema today:
- `indicators` — `pathfinder` + `geochem` (the latter populates as NGDB tilesets land)
- `lidar` — `hillshade` + `terrain-tools` (Terrain folded into LiDAR per `[C-11.1]`)

---

## 3 — Layer schema

```json
{
  "id": "gold-occurrences",
  "categoryId": "historic-gold",
  "subSection": null,
  "name": "Gold Occurrences",
  "desc": "USGS-recorded gold sites. Highest-confidence layer to start with.",
  "info": "USGS recorded gold sites. Filled dot = confirmed production history. ...",
  "count": "14,820 sites",
  "chipLabel": "🥇 Gold Sites",
  "thumb": "goldDots",
  "behavior": "fetchOnFirstToggle",
  "mapLayers": ["gold-occurrences-layer"],
  "comingSoon": false,
  "defaultOn": false,
  "pairsWith": []
}
```

### Field-by-field

| Field | Required | Notes |
|---|---|---|
| `id` | ✓ | Snake-case. Matches existing prod toggle ID for backward compat where one exists. |
| `categoryId` | ✓ | Single string. Q1=a — no array form. Cross-listing not supported. |
| `subSection` | optional (null OK) | ID within the category's `subSections`. |
| `name` | ✓ | Display name on card. |
| `desc` | ✓ | 1-2 sentence card body text. *Different from `info`* — `desc` is what you read while scanning. |
| `info` | ✓ | Full info-icon content. Q5=a — starter content from existing `LAYER_DESCRIPTIONS`; expand later in content session. |
| `count` | optional | Display string like `"14,820 sites"` or `"density"` or `null`. Treated as opaque string. |
| `chipLabel` | optional | String for active-layer bar chip. `null` for cards that don't appear in chip bar (default-on layers, sub-styles, comingSoon). |
| `thumb` | ✓ | Key into thumbnails registry. Style parked in `[E-15.3]`. Schema accepts a string. |
| `behavior` | ✓ | One of: `simple`, `fetchOnFirstToggle`, `derivedFromPoints`, `comingSoon`, `custom`, `lidar`. |
| `mapLayers` | ✓ | Array of Mapbox GL layer IDs whose visibility flips. Empty for `comingSoon` and dispatch-only behaviors. |
| `comingSoon` | optional, default `false` | Visual stub state per `[C-11.3]` policy A. |
| `defaultOn` | optional, default `false` | Initial layer state on first load. Currently only `active-claims` is default-on. |
| `pairsWith` | optional | Array of layer IDs as "pairs well with" chips. Q4=a — empty in initial port; content session later. |
| `subControl` | optional | When the card has more than on/off. See §4. |
| `derivedFromId` | required if `behavior=derivedFromPoints` | Layer ID whose fetch this depends on. |
| `customDispatch` | required if `behavior=custom` | Function name in `CUSTOM_DISPATCH` map. |
| `lidarStyleId` | required if `behavior=lidar` | Style ID matching `LIDAR_STYLES` in app-lidar.js. |

### Removed from earlier draft

- `proGated` — Q8 = MOOT. No tier system exists. Pro gating in current code is vestigial speculation. **Schema does not contain a `proGated` field.** Visual Pro badges drop. `checkProStatus()` calls in `toggleLayer` lines 1417–1448 get removed during port. Tier features can be reintroduced if and when tiers actually get designed.
- `fetchFn` — Q3 = b. Function names live in `LAYER_FETCH_BINDINGS` map in `app-layer-loader.js`, not in JSON.

---

## 4 — Sub-control schema

Two patterns expressed in the current schema. A third (`subtypeFilters`) was eliminated by Q2=a (5 separate Active Claims cards instead of one master with sub-toggles).

### 4.1 — Opacity slider (LiDAR per-style)

```json
"subControl": {
  "type": "opacitySlider",
  "min": 0,
  "max": 100,
  "default": 100,
  "appliesTo": "focused",
  "onChange": "updateLidarOpacity"
}
```

`appliesTo: "focused"` means "the slider drives the focused layer, not this card individually." Matches `[B-13]` LiDAR focus model.

### 4.2 — Multi-input (Custom Hillshade)

```json
"subControl": {
  "type": "multiInput",
  "inputs": [
    { "id": "az",  "label": "Azimuth",  "min": 0,   "max": 360, "default": 315, "unit": "°" },
    { "id": "alt", "label": "Altitude", "min": 1,   "max": 90,  "default": 45,  "unit": "°" },
    { "id": "z",   "label": "Z-factor", "min": 0.5, "max": 10,  "default": 2,   "step": 0.1, "unit": "×" }
  ],
  "resetButton": true,
  "onChange": "updateCustomParam",
  "onReset": "resetCustomHillshade"
}
```

Per Q6=a, Custom Hillshade ports from its standalone panel (currently anchored body-root for HTML.1 bypass per `[B-13]`) into a card under LiDAR's `hillshade` sub-section. Standalone panel goes away during port.

---

## 5 — Behavior dispatch contract

The loader (`app-layer-loader.js`) implements this dispatch:

```
dispatchLayerToggle(id):
  layer = LAYERS_BY_ID[id]
  layerState[id] = !layerState[id]  // flip first

  switch layer.behavior:

    "simple":
      flipVisibility(layer.mapLayers)

    "fetchOnFirstToggle":
      if turning on and !fetchedSet.has(id):
        await LAYER_FETCH_BINDINGS[id]()
        fetchedSet.add(id)
      flipVisibility(layer.mapLayers)

    "derivedFromPoints":
      if turning on and !fetchedSet.has(layer.derivedFromId):
        await LAYER_FETCH_BINDINGS[layer.derivedFromId]()
        fetchedSet.add(layer.derivedFromId)
      flipVisibility(layer.mapLayers)

    "comingSoon":
      un-flip layerState (never actually on)
      showStatus("...")
      return

    "lidar":
      un-flip layerState (toggleLidarStyle owns its state model)
      toggleLidarStyle(layer.lidarStyleId)

    "custom":
      CUSTOM_DISPATCH[layer.customDispatch](newState)
```

**Key principle:** the underlying fetch and lidar functions in `app-data.js` and `app-lidar.js` stay untouched. The loader replaces *only* the dispatch in current `toggleLayer`.

**Why the un-flip on `lidar` and `comingSoon`:** these branches own their own state. The default flip-first pattern would put `layerState[id]` out of sync with the truth.

---

## 6 — Drag-and-drop persistence

Per Q7=a, the v6 mockup's drag-and-drop tile reorder mechanic ports verbatim. Verified working in `unworkedgold_d3_map.html`:

- `.tile.dragging`, `.top-rail.drag-over`, `.tile.drag-target` CSS classes
- `dragstart`/`dragover`/`drop` event handlers
- `railsState = { top: [...], left: [...] }` — array of category IDs in display order
- `STORAGE_KEY = 'unworkedgold_layout_v1'` localStorage write on every drop

**Storage policy** per Q9 (collapsed by no-anonymous-users correction):
- `unworkedgold_layout_v1` (rail arrangement) and `unworkedgold_layers_v1` (layer state) live in localStorage during the session — fine, no big deal.
- For logged-in users, Supabase persistence per `[C-11.4]` is the cross-device save layer. Sync direction: localStorage → Supabase on login, Supabase → localStorage on app load.
- There are no anonymous users. Trial accounts minimum. Storage design doesn't need an "anonymous mode."

---

## 7 — Validation rules (loader runtime)

Loader runs these at boot and `console.error` on failure (no throw):

- All `categories[].id` unique.
- All `layers[].id` unique.
- Every `layers[].categoryId` resolves to a real category.
- Every `layers[].subSection` (when present) resolves to a `subSections[].id` in that category.
- Every `pairsWith[]` entry resolves to a real layer ID.
- `behavior=derivedFromPoints` requires `derivedFromId`, and that ID resolves.
- `behavior=custom` requires `customDispatch`, which the loader will look up in `CUSTOM_DISPATCH` map.
- `behavior=lidar` requires `lidarStyleId` matching an entry in `LIDAR_STYLES` (app-lidar.js).
- `behavior=comingSoon` should have empty `mapLayers`.

Validation failures don't crash the panel — they log clearly and skip the offending layer. This is friendly to incremental schema fill-in.

---

## 8 — Decisions baked in (full list)

For audit. Each item below answers a question raised in the Session 25 question gauntlet. "Moot" means the question collapsed when an underlying assumption was corrected.

| Q | Topic | Resolution |
|---|---|---|
| Q1 | Cross-listing layers | Single `categoryId`. No array. |
| Q2 | Active Claim subtypes | 5 separate cards. |
| Q3 | `fetchFn` location | JS binding map (`LAYER_FETCH_BINDINGS`), not JSON. |
| Q4 | `pairsWith` content | Empty in port; content session later. |
| Q5 | `info` content | Existing `LAYER_DESCRIPTIONS` as starter; expand later. |
| Q6 | Custom Hillshade | Card under LiDAR `hillshade` sub-section. Standalone panel deprecated. |
| Q7 | Drag-and-drop tile reorder | Port v6's working mechanic. |
| Q8 | Pro tier handling | **Moot.** No tier system. Pro fields/badges/gates removed. |
| Q9 | Anonymous storage | **Moot.** No anonymous users. |
| R1 | Rename `placer-density` | Yes → `historic-claim-density`. |
| R2 | Two missing Phase 1 tables | Research at port-start. |
| R3 | Watershed tool behavior type | Defer until that feature is closer. |
| R4 | Historical Topos placement | Defer to P2.10 BUILD. |
| R5 | Military Lands data source | Defer to `P1.18` audit. |

---

## 9 — Out-of-scope items (handed off to other work streams)

Per F.2 honesty discipline, these are explicitly NOT solved by this schema or the loader:

- **Loader code wiring into `app.js` boot sequence.** `loadLayerSchema()` exists; the call site in `app.js` is next session.
- **HTML scaffold** — top-rail / left-rail / modal / card-grid markup. Comes from v6 mockup port. Next session.
- **Card-builder code** — function that takes a layer object and renders its DOM. Next session. Card-bullet/card-name DOM IDs (`card-bullet-${id}` / `card-name-${id}`) are referenced in `_syncDomState` but not yet generated.
- **Tile-builder code** — function that renders rails from `railsState` + drag handlers ported from v6.
- **Modal renderer** — opens on tile click, builds card grid grouped by sub-section.
- **Pop-out chips** — v6 mockup's hover-over-tile preview of active layers.
- **Supabase persistence layer** — `[C-11.4]` per-user save. Likely its own session, ties to `[E-14]` Recipes feature shape.
- **HTML.1 fix** — explicitly out of P2.11 scope. Bypass continues.
- **`[E-15]` parked decisions** — Active vs Closed Claims placement, Density layer placement, thumbnail style. Schema accommodates whichever way they land.
- **Removing old layer-panel HTML** (`index.html` lines 136–530) — happens at flip-to-default session, not first BUILD session.

---

*End of LAYERS_SCHEMA.md — Session 25 final, decisions baked in.*
