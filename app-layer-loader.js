/* ============================================================
 * app-layer-loader.js
 *
 * Loads layers.json at boot and exposes:
 *   - LAYERS_BY_ID, CATEGORIES_BY_ID — lookup registries
 *   - dispatchLayerToggle(id) — replaces the big switch in toggleLayer
 *   - validateSchema() — runs at boot, logs errors, never throws
 *
 * Architecture notes:
 *   - Schema is data (layers.json). Behavior is JS (this file).
 *   - LAYER_FETCH_BINDINGS is the JS-side binding map per Q3=b
 *     decision in Session 25. Function names are NOT in JSON.
 *   - Custom dispatch (LiDAR styles, Custom Hillshade, 3D terrain)
 *     calls into existing functions in app-lidar.js / app.js.
 *     Loader doesn't replace those — only routes to them.
 *   - Pro gating REMOVED per Q8 = MOOT decision. checkProStatus()
 *     calls in old toggleLayer drop entirely.
 *
 * Cross-refs:
 *   - LAYERS_SCHEMA.md §5 dispatch contract
 *   - LAYER_ROSTER.md — full card inventory
 *   - layers.json — schema instance
 *
 * Status: Draft — Session 25, April 25, 2026.
 *   Awaits next BUILD session for HTML scaffold + test wiring.
 * ============================================================ */


/* ----------------------------------------------------------
 * BOOT — load schema, validate, populate registries
 * ---------------------------------------------------------- */

let LAYERS_BY_ID = {};
let CATEGORIES_BY_ID = {};
let SCHEMA_VERSION = null;
let _layersLoaded = false;

const _fetchedSet = new Set();   // tracks first-fetch state per layer

async function loadLayerSchema() {
  if (_layersLoaded) return;

  let schema;
  try {
    const resp = await fetch('layers.json?v=20260425');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    schema = await resp.json();
  } catch (err) {
    console.error('[layer-loader] failed to load layers.json:', err);
    return;
  }

  SCHEMA_VERSION = schema.schemaVersion;

  // Populate registries — strip _comment fields
  schema.categories.forEach(c => { CATEGORIES_BY_ID[c.id] = c; });
  schema.layers.forEach(l => { LAYERS_BY_ID[l.id] = l; });

  validateSchema(schema);

  _layersLoaded = true;
  console.info(`[layer-loader] loaded ${schema.layers.length} layers across ${schema.categories.length} categories (schema v${SCHEMA_VERSION})`);
}


/* ----------------------------------------------------------
 * VALIDATION — runs once at boot. Logs errors, never throws.
 * ---------------------------------------------------------- */

function validateSchema(schema) {
  const errors = [];

  // 1. Unique IDs
  const catIds = schema.categories.map(c => c.id);
  if (new Set(catIds).size !== catIds.length) errors.push('duplicate category IDs');

  const layerIds = schema.layers.map(l => l.id);
  if (new Set(layerIds).size !== layerIds.length) errors.push('duplicate layer IDs');

  // 2. Category references resolve
  schema.layers.forEach(l => {
    if (!CATEGORIES_BY_ID[l.categoryId]) {
      errors.push(`layer ${l.id}: unknown categoryId "${l.categoryId}"`);
    }
  });

  // 3. Sub-section references resolve
  schema.layers.forEach(l => {
    if (l.subSection) {
      const cat = CATEGORIES_BY_ID[l.categoryId];
      const validSubs = (cat?.subSections || []).map(s => s.id);
      if (!validSubs.includes(l.subSection)) {
        errors.push(`layer ${l.id}: unknown subSection "${l.subSection}" in category ${l.categoryId}`);
      }
    }
  });

  // 4. pairsWith references resolve
  schema.layers.forEach(l => {
    (l.pairsWith || []).forEach(p => {
      if (!LAYERS_BY_ID[p]) errors.push(`layer ${l.id}: pairsWith "${p}" not found`);
    });
  });

  // 5. derivedFromPoints needs derivedFromId
  schema.layers.forEach(l => {
    if (l.behavior === 'derivedFromPoints' && !l.derivedFromId) {
      errors.push(`layer ${l.id}: derivedFromPoints requires derivedFromId`);
    }
    if (l.derivedFromId && !LAYERS_BY_ID[l.derivedFromId]) {
      errors.push(`layer ${l.id}: derivedFromId "${l.derivedFromId}" not found`);
    }
  });

  // 6. Custom behavior needs customDispatch
  schema.layers.forEach(l => {
    if (l.behavior === 'custom' && !l.customDispatch) {
      errors.push(`layer ${l.id}: behavior=custom requires customDispatch`);
    }
  });

  // 7. comingSoon should have empty mapLayers
  schema.layers.forEach(l => {
    if (l.behavior === 'comingSoon' && l.mapLayers && l.mapLayers.length > 0) {
      errors.push(`layer ${l.id}: comingSoon should have empty mapLayers (got ${l.mapLayers.length})`);
    }
  });

  // 8. lidar behavior needs lidarStyleId
  schema.layers.forEach(l => {
    if (l.behavior === 'lidar' && !l.lidarStyleId) {
      errors.push(`layer ${l.id}: behavior=lidar requires lidarStyleId`);
    }
  });

  if (errors.length) {
    console.error('[layer-loader] schema validation errors:', errors);
  }
}


/* ----------------------------------------------------------
 * FETCH BINDING MAP (Q3 = b)
 *
 * Maps layer IDs to fetch functions in app-data.js. Adding a new
 * fetchOnFirstToggle layer requires editing two places:
 *   1. layers.json — add the entry
 *   2. this map     — add the fetch function reference
 * ---------------------------------------------------------- */

const LAYER_FETCH_BINDINGS = {
  'gold-occurrences': () => fetchGoldOccurrences(),
  'hist-mines':       () => fetchHistoricMines(),
  'mercury':          () => fetchMercury(),
  'chromium':         () => fetchChromium(),
  'copper':           () => fetchCopper(),
  'antimony':         () => fetchAntimony(),
  'silver':           () => fetchSilver(),
  'open-land':        () => fetchBLMBoundaries(),
  'open-to-claim':    () => fetchOpenToClaim(),
  'plss':             () => fetchPLSS(),
  'blm-roads':        () => fetchBLMRoads(),
  'natl-parks':       () => fetchNationalParks(),
  'wilderness':       () => fetchWilderness(),
  'monuments':        () => fetchMonuments(),
  'wild-scenic':      () => fetchWildScenic(),
  'tribal':           () => fetchTribalLands(),
  'military':         () => fetchMilitaryAreas()
};


/* ----------------------------------------------------------
 * CUSTOM DISPATCH MAP
 *
 * For behavior=custom layers — routes to existing functions.
 * Names match layers.json customDispatch field.
 * ---------------------------------------------------------- */

const CUSTOM_DISPATCH = {
  'toggleCustomHillshade': (newState) => toggleCustomHillshade(newState),
  'setTerrain3D':          (newState) => setTerrain3D(newState)
};


/* ----------------------------------------------------------
 * MAIN DISPATCH — replaces the big switch in old toggleLayer
 *
 * Called from layer-card click handlers. Routes by behavior:
 *   - simple             — flip mapLayers visibility
 *   - fetchOnFirstToggle — first call: fetch then flip; later: flip
 *   - derivedFromPoints  — fetch underlying points first, then flip
 *   - comingSoon         — show toast, do nothing
 *   - custom             — call into CUSTOM_DISPATCH
 *   - lidar              — call existing toggleLidarStyle()
 *
 * Returns: new layer state (true if turned ON, false if OFF).
 * ---------------------------------------------------------- */

async function dispatchLayerToggle(id) {
  const layer = LAYERS_BY_ID[id];
  if (!layer) {
    console.error(`[layer-loader] unknown layer "${id}"`);
    return false;
  }

  // Flip the state up front
  layerState[id] = !layerState[id];
  const newState = layerState[id];

  switch (layer.behavior) {

    case 'simple':
      _flipVisibility(layer.mapLayers, newState);
      break;

    case 'fetchOnFirstToggle':
      if (newState && !_fetchedSet.has(id)) {
        const fetchFn = LAYER_FETCH_BINDINGS[id];
        if (fetchFn) {
          await fetchFn();
          _fetchedSet.add(id);
        } else {
          console.error(`[layer-loader] no fetch binding for "${id}"`);
        }
      }
      _flipVisibility(layer.mapLayers, newState);
      break;

    case 'derivedFromPoints':
      // Heatmap pattern — auto-fetch underlying point data
      if (newState && !_fetchedSet.has(layer.derivedFromId)) {
        const fetchFn = LAYER_FETCH_BINDINGS[layer.derivedFromId];
        if (fetchFn) {
          await fetchFn();
          _fetchedSet.add(layer.derivedFromId);
        }
      }
      _flipVisibility(layer.mapLayers, newState);
      break;

    case 'comingSoon':
      layerState[id] = false;  // never actually turns on
      showStatus(`${layer.name} — coming soon`);
      return false;

    case 'lidar':
      // Routes to existing app-lidar.js — handles its own state model
      // (activeLidarStyles Set, focusedLidarId, opacity slider focus).
      // We don't manipulate layerState here — toggleLidarStyle owns it.
      layerState[id] = !newState;  // un-flip; toggleLidarStyle is source of truth
      toggleLidarStyle(layer.lidarStyleId);
      break;

    case 'custom':
      const dispatchFn = CUSTOM_DISPATCH[layer.customDispatch];
      if (dispatchFn) {
        dispatchFn(newState);
      } else {
        console.error(`[layer-loader] no custom dispatch for "${layer.customDispatch}"`);
      }
      break;

    default:
      console.error(`[layer-loader] unknown behavior "${layer.behavior}" for "${id}"`);
  }

  // Mirror existing UI state: bullet, name class, hidden compat toggle
  _syncDomState(id, newState);

  // Active-layer chip bar update
  updateActiveLayerBar();

  return newState;
}


/* ----------------------------------------------------------
 * HELPERS
 * ---------------------------------------------------------- */

function _flipVisibility(mapLayers, on) {
  if (!map || !mapLayers) return;
  const vis = on ? 'visible' : 'none';
  mapLayers.forEach(lyr => {
    if (map.getLayer(lyr)) map.setLayoutProperty(lyr, 'visibility', vis);
  });
}

function _syncDomState(id, on) {
  // Mockup-style card glow: whole card gets .on class.
  const card = document.getElementById(`card-${id}`);
  if (card) card.classList.toggle('on', on);

  // Card status text ("ON ●" vs "+ ADD") — matches mockup.
  const status = document.getElementById(`card-status-${id}`);
  if (status) status.textContent = on ? 'ON \u25CF' : '+ ADD';

  // Legacy bullet + name (kept for any code that targets them by ID).
  const bullet = document.getElementById(`card-bullet-${id}`);
  const name   = document.getElementById(`card-name-${id}`);
  if (bullet) bullet.classList.toggle('on', on);
  if (name)   name.classList.toggle('on', on);

  // Hidden compat toggle in old layer panel (kept during migration).
  const compatToggle = document.getElementById(`toggle-${id}`);
  if (compatToggle) compatToggle.classList.toggle('on', on);

  // After any dispatch, refresh tile state (badge counts + has-active).
  if (typeof _refreshRailState === 'function') _refreshRailState();
}


/* ----------------------------------------------------------
 * EXPORT — these become globally available because we don't
 * use modules. Following the same pattern as app-layers.js etc.
 * ---------------------------------------------------------- */

// loadLayerSchema() called from app.js boot sequence.
// dispatchLayerToggle(id) called from card click handlers.
// LAYERS_BY_ID / CATEGORIES_BY_ID consumed by card-builder + tile-builder.


/* ----------------------------------------------------------
 * BOOT — preload schema on DOMContentLoaded so registries are
 * ready when Step 4 wires the new Layers flyout. No rendering
 * here — the legacy v6 5+5 tile scaffold was removed in the
 * desktop UI rebuild (Session 37, 2026-05-02).
 * ---------------------------------------------------------- */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadLayerSchema);
} else {
  setTimeout(loadLayerSchema, 0);
}

