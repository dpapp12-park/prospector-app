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


/* ============================================================
 * NEW LAYER PANEL — feature-flagged behind ?newpanel=1
 *
 * Everything below is the v6 mockup port: scaffold, rails,
 * tiles, modal, cards, drag-and-drop. Boot is gated on the
 * URL flag; if the flag is not present, this code does nothing
 * and the existing #layer-panel keeps working as today.
 *
 * Visual classes are namespaced under #newpanel-root in CSS
 * so the mockup's color variable overrides do not leak into
 * the rest of the app.
 *
 * Session 26 — Historic Gold tile is the proof-of-concept.
 * ============================================================ */

const NEW_PANEL_LAYOUT_KEY = 'unworkedgold_layout_v1';
let _railsState = null;
let _activeModalCat = null;
let _newPanelMounted = false;
let _newPanelDragState = null;
let _newPanelToastTimer = null;
let _newPanelPopoutTimer = null;

function _isNewPanelEnabled() {
  return true; // new panel is now always-on
}

function _loadRailsState() {
  try {
    const saved = localStorage.getItem(NEW_PANEL_LAYOUT_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.top) && Array.isArray(parsed.left)) {
        // Drop any unknown ids (schema may have changed since last save).
        const knownIds = new Set(Object.keys(CATEGORIES_BY_ID));
        const top  = parsed.top.filter(id => knownIds.has(id));
        const left = parsed.left.filter(id => knownIds.has(id));
        // Add any new categories that weren't in saved state, to their defaults.
        Object.values(CATEGORIES_BY_ID).forEach(c => {
          if (top.includes(c.id) || left.includes(c.id)) return;
          (c.defaultRail === 'left' ? left : top).push(c.id);
        });
        return { top, left };
      }
    }
  } catch (e) {
    console.warn('[layer-loader] could not parse saved rails state:', e);
  }
  // Default arrangement from schema.
  return _defaultRailsState();
}

function _defaultRailsState() {
  const top = [], left = [];
  Object.values(CATEGORIES_BY_ID).forEach(c => {
    (c.defaultRail === 'left' ? left : top).push(c.id);
  });
  return { top, left };
}

function _saveRailsState() {
  try {
    localStorage.setItem(NEW_PANEL_LAYOUT_KEY, JSON.stringify(_railsState));
  } catch (e) {
    console.warn('[layer-loader] could not save rails state:', e);
  }
}


/* ----------------------------------------------------------
 * ICONS — ported verbatim from v6 mockup. iconKey strings in
 * categories[].iconKey resolve here.
 * ---------------------------------------------------------- */

const NEW_PANEL_ICONS = {
  historicGold: '<svg class="solid" viewBox="0 0 24 24"><circle cx="12" cy="6" r="2.5"/><circle cx="6" cy="14" r="2.5"/><circle cx="18" cy="14" r="2.5"/></svg>',
  indicators:   '<svg viewBox="0 0 24 24"><path d="M 9 4 L 15 4 L 15 10 L 18 17 C 18 19 17 20 15 20 L 9 20 C 7 20 6 19 6 17 L 9 10 Z"/><line x1="9" y1="4" x2="15" y2="4"/></svg>',
  geology:      '<svg class="solid" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="2"/><rect x="3" y="11" width="18" height="2"/><rect x="3" y="16" width="18" height="2"/></svg>',
  claims:       '<svg viewBox="0 0 24 24"><line x1="6" y1="3" x2="6" y2="21"/><polygon points="6,4 18,4 14,9 18,14 6,14"/></svg>',
  prospects:    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="9.5"/></svg>',
  land:         '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
  roads:        '<svg viewBox="0 0 24 24"><path d="M 4 21 L 8 3"/><path d="M 20 21 L 16 3"/><line x1="12" y1="6" x2="12" y2="8"/><line x1="12" y1="11" x2="12" y2="13"/><line x1="12" y1="16" x2="12" y2="18"/></svg>',
  protected:    '<svg viewBox="0 0 24 24"><path d="M 12 3 L 19 6 L 19 12 C 19 17 16 20 12 21 C 8 20 5 17 5 12 L 5 6 Z"/></svg>',
  water:        '<svg viewBox="0 0 24 24"><path d="M 3 8 Q 7 6 11 8 T 21 8"/><path d="M 3 13 Q 7 11 11 13 T 21 13"/><path d="M 3 18 Q 7 16 11 18 T 21 18"/></svg>',
  lidar:        '<svg viewBox="0 0 24 24"><path d="M 4 16 Q 12 8 20 16"/><path d="M 7 19 Q 12 14 17 19"/><circle cx="12" cy="20.5" r="1.2" fill="currentColor" stroke="none"/></svg>'
};


/* ----------------------------------------------------------
 * THUMBNAILS — ported from v6 mockup thumb() function.
 * Returns SVG markup string per thumb key in layers.json.
 * ---------------------------------------------------------- */

function _newPanelThumb(kind) {
  const bg   = '<rect width="100%" height="100%" fill="#1F2624"/>';
  const topo = '<path d="M 0 20 Q 45 10 90 25 T 180 20" stroke="rgba(255,255,255,0.08)" stroke-width="0.5" fill="none"/><path d="M 0 45 Q 45 35 90 50 T 180 45" stroke="rgba(255,255,255,0.08)" stroke-width="0.5" fill="none"/>';
  const m = {
    goldDots: `${bg}${topo}<circle cx="35" cy="22" r="2" fill="#C9A84C"/><circle cx="58" cy="35" r="2" fill="#C9A84C"/><circle cx="85" cy="20" r="2" fill="#C9A84C"/><circle cx="110" cy="38" r="2" fill="#C9A84C"/><circle cx="135" cy="28" r="2" fill="#C9A84C"/><circle cx="155" cy="46" r="2" fill="#C9A84C"/>`,
    hollowCircles: `${bg}${topo}<circle cx="40" cy="22" r="3" fill="none" stroke="#E8E4D4" stroke-width="1"/><circle cx="80" cy="40" r="3" fill="none" stroke="#E8E4D4" stroke-width="1"/><circle cx="120" cy="20" r="3" fill="none" stroke="#E8E4D4" stroke-width="1"/><circle cx="150" cy="42" r="3" fill="none" stroke="#E8E4D4" stroke-width="1"/>`,
    heatmapPlacer: `${bg}<rect x="50" y="22" width="22" height="22" fill="rgba(201,168,76,0.18)"/><rect x="43" y="15" width="36" height="36" fill="rgba(201,168,76,0.10)"/><rect x="35" y="8" width="52" height="52" fill="rgba(201,168,76,0.05)"/><rect x="105" y="20" width="20" height="20" fill="rgba(201,168,76,0.18)"/><rect x="100" y="15" width="30" height="30" fill="rgba(201,168,76,0.08)"/>`,
    heatmapLode: `${bg}<rect x="50" y="22" width="22" height="22" fill="rgba(245,166,35,0.20)"/><rect x="40" y="12" width="42" height="42" fill="rgba(245,166,35,0.08)"/><rect x="115" y="18" width="20" height="22" fill="rgba(245,166,35,0.20)"/>`,
    faultLines: `${bg}${topo}<path d="M 10 50 Q 50 20 90 40 T 170 30" stroke="#E91E63" stroke-width="1.4" fill="none"/><path d="M 20 25 L 60 35 L 100 22 L 140 38" stroke="#E91E63" stroke-width="1.4" fill="none"/>`,
    purpleDots: `${bg}${topo}<circle cx="40" cy="25" r="2" fill="#9C27B0"/><circle cx="70" cy="40" r="2" fill="#9C27B0"/><circle cx="95" cy="22" r="2" fill="#9C27B0"/><circle cx="120" cy="48" r="2" fill="#9C27B0"/><circle cx="148" cy="30" r="2" fill="#9C27B0"/>`,
    cyanDots: `${bg}${topo}<circle cx="40" cy="28" r="2" fill="#00BCD4"/><circle cx="75" cy="42" r="2" fill="#00BCD4"/><circle cx="115" cy="22" r="2" fill="#00BCD4"/><circle cx="142" cy="38" r="2" fill="#00BCD4"/>`,
    orangeDots: `${bg}${topo}<circle cx="40" cy="25" r="2" fill="#E87722"/><circle cx="80" cy="40" r="2" fill="#E87722"/><circle cx="120" cy="22" r="2" fill="#E87722"/><circle cx="150" cy="42" r="2" fill="#E87722"/>`,
    grayDots: `${bg}${topo}<circle cx="40" cy="25" r="2" fill="#B0BEC5"/><circle cx="78" cy="40" r="2" fill="#B0BEC5"/><circle cx="125" cy="22" r="2" fill="#B0BEC5"/>`,
    antimony: `${bg}${topo}<circle cx="38" cy="28" r="2" fill="#78909C"/><circle cx="80" cy="42" r="2" fill="#78909C"/><circle cx="120" cy="24" r="2" fill="#78909C"/><circle cx="148" cy="40" r="2" fill="#78909C"/>`,
    claimsCyan: `${bg}<rect x="20" y="14" width="32" height="16" fill="rgba(60,196,214,0.10)" stroke="#3CC4D6" stroke-width="0.8"/><rect x="56" y="14" width="32" height="16" fill="rgba(60,196,214,0.10)" stroke="#3CC4D6" stroke-width="0.8"/><rect x="92" y="14" width="32" height="16" fill="rgba(60,196,214,0.10)" stroke="#3CC4D6" stroke-width="0.8"/><rect x="20" y="34" width="32" height="16" fill="rgba(60,196,214,0.10)" stroke="#3CC4D6" stroke-width="0.8"/><rect x="56" y="34" width="32" height="16" fill="rgba(60,196,214,0.10)" stroke="#3CC4D6" stroke-width="0.8"/>`,
    claimsClosed: `${bg}<rect x="20" y="14" width="32" height="16" fill="rgba(120,120,120,0.10)" stroke="#7A7A7A" stroke-width="0.8" stroke-dasharray="2,2"/><rect x="56" y="14" width="32" height="16" fill="rgba(120,120,120,0.10)" stroke="#7A7A7A" stroke-width="0.8" stroke-dasharray="2,2"/><rect x="92" y="34" width="32" height="16" fill="rgba(120,120,120,0.10)" stroke="#7A7A7A" stroke-width="0.8" stroke-dasharray="2,2"/>`,
    shadeGray: `<rect width="100%" height="100%" fill="#3a3a3a"/><path d="M 0 32 Q 45 18 90 32 T 180 32" stroke="rgba(255,255,255,0.18)" stroke-width="6" fill="none"/><path d="M 0 50 Q 45 38 90 50 T 180 50" stroke="rgba(0,0,0,0.25)" stroke-width="4" fill="none"/>`,
    shadeMulti: `<rect width="100%" height="100%" fill="#3a3a3a"/><path d="M 0 32 Q 45 18 90 32 T 180 32" stroke="rgba(255,255,255,0.20)" stroke-width="6" fill="none"/><path d="M 0 50 Q 45 38 90 50 T 180 50" stroke="rgba(0,0,0,0.30)" stroke-width="4" fill="none"/>`,
    shadeTinted: `<rect width="100%" height="100%" fill="#5e4d3a"/><path d="M 0 32 Q 45 18 90 32 T 180 32" stroke="rgba(255,220,150,0.28)" stroke-width="6" fill="none"/><path d="M 0 50 Q 45 38 90 50 T 180 50" stroke="rgba(60,40,20,0.40)" stroke-width="4" fill="none"/>`,
    slope: `<rect width="100%" height="100%" fill="#1F2624"/><rect x="0" y="0" width="180" height="22" fill="rgba(95,158,71,0.4)"/><rect x="0" y="22" width="180" height="20" fill="rgba(228,194,60,0.4)"/><rect x="0" y="42" width="180" height="22" fill="rgba(220,80,60,0.4)"/>`,
    aspect: `<rect width="100%" height="100%" fill="#1F2624"/><circle cx="90" cy="32" r="22" fill="rgba(0,0,0,0)"/><path d="M 90 32 L 90 10 A 22 22 0 0 1 112 32 Z" fill="rgba(220,80,60,0.5)"/><path d="M 90 32 L 112 32 A 22 22 0 0 1 90 54 Z" fill="rgba(228,194,60,0.5)"/><path d="M 90 32 L 90 54 A 22 22 0 0 1 68 32 Z" fill="rgba(95,158,71,0.5)"/><path d="M 90 32 L 68 32 A 22 22 0 0 1 90 10 Z" fill="rgba(95,140,200,0.5)"/>`,
    contour: `<rect width="100%" height="100%" fill="#1F2624"/><path d="M 0 14 Q 45 6 90 16 T 180 14" stroke="rgba(232,228,212,0.6)" stroke-width="0.6" fill="none"/><path d="M 0 26 Q 45 18 90 28 T 180 26" stroke="rgba(232,228,212,0.6)" stroke-width="0.6" fill="none"/><path d="M 0 38 Q 45 30 90 40 T 180 38" stroke="rgba(232,228,212,0.6)" stroke-width="0.6" fill="none"/><path d="M 0 50 Q 45 42 90 52 T 180 50" stroke="rgba(232,228,212,0.6)" stroke-width="0.6" fill="none"/>`,
    mountain: `<rect width="100%" height="100%" fill="#1F2624"/><polygon points="0,64 50,20 100,40 150,15 180,30 180,64" fill="rgba(120,120,110,0.5)"/><polygon points="0,64 30,40 60,50 90,28 120,45 150,38 180,50 180,64" fill="rgba(60,60,55,0.7)"/>`,
    sma: `<rect width="100%" height="100%" fill="#1F2624"/><rect x="0" y="0" width="60" height="64" fill="rgba(228,194,60,0.18)"/><rect x="60" y="0" width="60" height="64" fill="rgba(95,158,71,0.18)"/><rect x="120" y="0" width="60" height="64" fill="rgba(170,140,90,0.18)"/>`,
    openClaim: `<rect width="100%" height="100%" fill="#1F2624"/><rect x="0" y="0" width="180" height="64" fill="rgba(95,158,71,0.22)"/><rect x="50" y="20" width="35" height="20" fill="rgba(120,40,40,0.5)"/>`,
    grid: `<rect width="100%" height="100%" fill="#1F2624"/><line x1="0" y1="16" x2="180" y2="16" stroke="rgba(232,228,212,0.3)" stroke-width="0.5"/><line x1="0" y1="32" x2="180" y2="32" stroke="rgba(232,228,212,0.3)" stroke-width="0.5"/><line x1="0" y1="48" x2="180" y2="48" stroke="rgba(232,228,212,0.3)" stroke-width="0.5"/><line x1="36" y1="0" x2="36" y2="64" stroke="rgba(232,228,212,0.3)" stroke-width="0.5"/><line x1="72" y1="0" x2="72" y2="64" stroke="rgba(232,228,212,0.3)" stroke-width="0.5"/><line x1="108" y1="0" x2="108" y2="64" stroke="rgba(232,228,212,0.3)" stroke-width="0.5"/><line x1="144" y1="0" x2="144" y2="64" stroke="rgba(232,228,212,0.3)" stroke-width="0.5"/>`,
    restricted: `<rect width="100%" height="100%" fill="#1F2624"/><defs><pattern id="hatch-np" width="6" height="6" patternUnits="userSpaceOnUse"><line x1="0" y1="6" x2="6" y2="0" stroke="rgba(220,80,60,0.5)" stroke-width="1"/></pattern></defs><rect x="20" y="10" width="140" height="44" fill="url(#hatch-np)" stroke="rgba(220,80,60,0.6)" stroke-width="0.8"/>`,
    tribal: `<rect width="100%" height="100%" fill="#1F2624"/><rect x="20" y="10" width="140" height="44" fill="rgba(140,90,200,0.18)" stroke="rgba(140,90,200,0.5)" stroke-width="0.8"/>`,
    military: `<rect width="100%" height="100%" fill="#1F2624"/><rect x="30" y="14" width="120" height="36" fill="rgba(120,120,120,0.20)" stroke="rgba(120,120,120,0.6)" stroke-width="0.8" stroke-dasharray="3,2"/>`,
    roads: `<rect width="100%" height="100%" fill="#1F2624"/><path d="M 0 18 Q 60 10 100 22 T 180 30" stroke="rgba(228,180,90,0.7)" stroke-width="1.5" fill="none"/><path d="M 0 45 L 80 38 L 180 50" stroke="rgba(228,180,90,0.7)" stroke-width="1.5" fill="none"/>`,
    streamGauge: `<rect width="100%" height="100%" fill="#1F2624"/><path d="M 0 20 Q 60 35 90 30 T 180 40" stroke="rgba(95,140,200,0.5)" stroke-width="3" fill="none"/><circle cx="90" cy="32" r="3.5" fill="#3CC4D6"/><circle cx="90" cy="32" r="6" fill="none" stroke="#3CC4D6" stroke-width="0.6" opacity="0.5"/>`
  };
  return `<svg viewBox="0 0 180 64" preserveAspectRatio="none">${m[kind] || bg}</svg>`;
}


/* ----------------------------------------------------------
 * SCAFFOLD MOUNT — creates the new panel DOM under #newpanel-root.
 * ---------------------------------------------------------- */

function _mountNewPanelScaffold() {
  if (document.getElementById('newpanel-root')) return;

  const root = document.createElement('div');
  root.id = 'newpanel-root';
  root.innerHTML = `
    <div class="np-top-controls">
      <button class="np-toolbar-action" id="np-reset-btn" title="Reset both rails to default arrangement">Reset Tool Bar</button>
      <div class="np-top-rail" id="np-top-rail" data-rail="top"></div>
      <button class="np-toolbar-action danger" id="np-clear-btn" title="Turn off all active layers">Clear Layers</button>
    </div>
    <div class="np-left-rail" id="np-left-rail" data-rail="left"></div>
    <div id="np-top-left">
      <div class="np-wordmark">UNWORKED <span class="np-wordmark-gold">GOLD</span></div>
      <div class="np-version">field instrument · v0.5</div>
      <div class="np-readouts">
        <div class="np-coords" id="np-coords">\u2014</div>
        <div class="np-price">Au <span id="np-gold-value">\u2014</span> <span class="np-arrow" id="np-gold-arrow"></span></div>
      </div>
    </div>
    <div class="np-right-rail" id="np-right-rail">
      <button class="np-right-tile" data-action="search" title="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.5" y2="16.5"/></svg><span class="np-right-tile-label">Search</span></button>
      <button class="np-right-tile" data-action="pin" title="Drop pin"><svg viewBox="0 0 24 24"><path d="M12 2 C8 2 5 5 5 9 c0 5 7 13 7 13 s7 -8 7 -13 c0 -4 -3 -7 -7 -7 z"/><circle cx="12" cy="9" r="2.5"/></svg><span class="np-right-tile-label">Pin</span></button>
      <button class="np-right-tile" data-action="draw" title="Draw to search claims"><svg viewBox="0 0 24 24"><polygon points="12,3 21,8 18,19 6,19 3,8"/></svg><span class="np-right-tile-label">Draw</span></button>
      <div class="np-right-divider"></div>
      <button class="np-right-tile" data-action="gps" title="My location"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg><span class="np-right-tile-label">GPS</span></button>
      <button class="np-right-tile" data-action="compass" title="Reset north"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polygon points="12,4 14,12 12,14 10,12" fill="currentColor" stroke="none"/><polygon points="12,20 14,12 12,10 10,12" opacity="0.4" fill="currentColor" stroke="none"/></svg><span class="np-right-tile-label">North</span></button>
      <button class="np-right-tile" data-action="style" title="Map style"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/></svg><span class="np-right-tile-label">Style</span></button>
      <button class="np-right-tile" data-action="3d" title="Toggle 3D terrain"><svg viewBox="0 0 24 24"><polygon points="3,20 9,10 13,15 17,7 21,20"/></svg><span class="np-right-tile-label">3D</span></button>
      <div class="np-right-divider"></div>
      <button class="np-right-tile" data-action="measure" title="Measure (coming soon)"><svg viewBox="0 0 24 24"><path d="M3 16 L16 3 L21 8 L8 21 Z"/><line x1="7" y1="12" x2="9" y2="14"/><line x1="10" y1="9" x2="12" y2="11"/><line x1="13" y1="6" x2="15" y2="8"/></svg><span class="np-right-tile-label">Measure</span></button>
      <button class="np-right-tile" data-action="show" title="Show"><svg viewBox="0 0 24 24"><path d="M2 12 s4 -7 10 -7 s10 7 10 7 s-4 7 -10 7 s-10 -7 -10 -7 z"/><circle cx="12" cy="12" r="3"/></svg><span class="np-right-tile-label">Show</span></button>
      <div class="np-right-divider"></div>
      <button class="np-right-tile ai" data-action="ai" title="AI tools"><svg viewBox="0 0 24 24"><path d="M12 2 L14 9 L21 11 L14 13 L12 20 L10 13 L3 11 L10 9 Z"/></svg><span class="np-right-tile-label">AI</span></button>
      <div class="np-right-divider"></div>
      <button class="np-right-tile" data-action="account" title="Account"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21 c0 -5 4 -8 8 -8 s8 3 8 8"/></svg><span class="np-right-tile-label">Account</span></button>
    </div>
    <div class="np-modal-backdrop" id="np-modal-backdrop">
      <div class="np-modal">
        <div class="np-modal-header">
          <div>
            <div class="np-modal-eyebrow">Field notebook</div>
            <div class="np-modal-title" id="np-modal-title">Category</div>
            <div class="np-modal-subtitle" id="np-modal-subtitle"></div>
          </div>
          <button class="np-modal-close" id="np-modal-close">\u00D7</button>
        </div>
        <div class="np-modal-body">
          <div class="np-card-grid" id="np-card-grid"></div>
        </div>
      </div>
    </div>
    <div class="np-toast" id="np-toast"></div>
  `;
  document.body.appendChild(root);

  // Wire fixed controls
  document.getElementById('np-modal-close').addEventListener('click', _closeNewPanelModal);
  document.getElementById('np-modal-backdrop').addEventListener('click', e => {
    if (e.target.id === 'np-modal-backdrop') _closeNewPanelModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _activeModalCat) _closeNewPanelModal();
  });

  document.getElementById('np-reset-btn').addEventListener('click', () => {
    localStorage.removeItem(NEW_PANEL_LAYOUT_KEY);
    _railsState = _defaultRailsState();
    _renderRails();
    _newPanelToast('Tool bar reset to default');
  });

  document.getElementById('np-clear-btn').addEventListener('click', async () => {
    // Turn off every layer that is currently on. Avoid lidar/comingSoon/custom
    // — those have side effects and own state we do not want to touch broadly.
    const ids = Object.keys(LAYERS_BY_ID).filter(id => {
      const l = LAYERS_BY_ID[id];
      if (!layerState[id]) return false;
      if (l.behavior === 'comingSoon' || l.behavior === 'lidar' || l.behavior === 'custom') return false;
      return true;
    });
    for (const id of ids) {
      await dispatchLayerToggle(id);
    }
    if (_activeModalCat) _renderModalCards(_activeModalCat);
    _renderRails();
    _newPanelToast('Layers cleared');
  });

  // Right rail click delegation. Each tile carries data-action; one
  // listener routes to the correct handler. Search toggles the
  // existing #searchbar (relocated by CSS under .newpanel-on).
  document.getElementById('np-right-rail').addEventListener('click', (e) => {
    const btn = e.target.closest('.np-right-tile');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'search') {
      const sb = document.getElementById('searchbar');
      if (!sb) return;
      const isOpen = sb.classList.toggle('np-search-open');
      btn.classList.toggle('active', isOpen);
      if (isOpen) {
        // Align searchbar's top edge with the Search tile's top.
        const tileRect = btn.getBoundingClientRect();
        sb.style.top = tileRect.top + 'px';
        const input = document.getElementById('search-input');
        if (input) setTimeout(() => input.focus(), 50);
      } else {
        sb.style.top = '';
      }
      return;
    }

    if (action === 'pin') {
      // Tap-to-save behavior matches the existing FAB tap path.
      if (typeof openSpotFromFAB === 'function') openSpotFromFAB();
      return;
    }

    if (action === 'ai') {
      if (typeof toggleAIMenu === 'function') toggleAIMenu();
      return;
    }

    if (action === 'account') {
      if (typeof openAccountPanel === 'function') openAccountPanel();
      return;
    }

    if (action === 'measure' || action === 'show') {
      // Placeholder tiles per v6 mockup — no behavior yet.
      _newPanelToast(action === 'measure' ? 'Measure — coming soon' : 'Show — coming soon');
      return;
    }

    if (action === 'gps')     { if (typeof locateUser    === 'function') locateUser();    return; }
    if (action === 'compass') { if (typeof resetBearing  === 'function') resetBearing();  return; }
    if (action === 'style')   { if (typeof toggleStyles  === 'function') toggleStyles();  return; }
    if (action === '3d')      { if (typeof toggle3D      === 'function') toggle3D();      return; }
    if (action === 'draw')    { if (typeof toggleDraw    === 'function') toggleDraw();    return; }
  });

  // Click outside #searchbar closes it (only under newpanel mode).
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('newpanel-on')) return;
    const sb = document.getElementById('searchbar');
    if (!sb || !sb.classList.contains('np-search-open')) return;
    if (sb.contains(e.target)) return;
    if (e.target.closest('#np-right-rail .np-right-tile[data-action="search"]')) return;
    sb.classList.remove('np-search-open');
    sb.style.top = '';
    const searchTile = document.querySelector('#np-right-rail .np-right-tile[data-action="search"]');
    if (searchTile) searchTile.classList.remove('active');
  });

  // Top-left coords + gold price sync.
  // Coords: poll map.on('move') and write to #np-coords. Map may
  //   not exist yet when scaffold mounts, so we retry until it does.
  // Gold price: mirror #gold-price-value (lives inside hidden
  //   #account-panel) via MutationObserver. Trigger one fetch on
  //   boot so something flows in. Per [P1.14] both endpoints are
  //   currently broken — element will likely show "—" until that's
  //   fixed.
  function _initNpTopLeft() {
    if (typeof map === 'undefined' || !map) {
      setTimeout(_initNpTopLeft, 200);
      return;
    }
    const coordsEl = document.getElementById('np-coords');
    const sync = () => {
      if (!coordsEl) return;
      const c = map.getCenter();
      const lat = c.lat >= 0 ? c.lat.toFixed(3) + '\u00B0N' : Math.abs(c.lat).toFixed(3) + '\u00B0S';
      const lng = c.lng >= 0 ? c.lng.toFixed(3) + '\u00B0E' : Math.abs(c.lng).toFixed(3) + '\u00B0W';
      coordsEl.textContent = lat + ' \u00B7 ' + lng;
    };
    sync();
    map.on('move', sync);

    if (typeof fetchGoldPrice === 'function') fetchGoldPrice();
    const srcEl = document.getElementById('gold-price-value');
    const dstEl = document.getElementById('np-gold-value');
    if (srcEl && dstEl) {
      const mirror = () => { dstEl.textContent = srcEl.textContent || '\u2014'; };
      mirror();
      const obs = new MutationObserver(mirror);
      obs.observe(srcEl, { childList: true, characterData: true, subtree: true });
    }
  }
  _initNpTopLeft();

  // Document-level drag listeners (single bind, mockup pattern).
  document.addEventListener('dragover', _onNewPanelDragOver);
  document.addEventListener('drop', _onNewPanelDrop);

  _newPanelMounted = true;
}


/* ----------------------------------------------------------
 * RENDER — rails (tiles) and modal (cards).
 * ---------------------------------------------------------- */

function _renderRails() {
  if (!_newPanelMounted) return;
  ['top', 'left'].forEach(rail => {
    const el = document.getElementById('np-' + rail + '-rail');
    if (!el) return;
    el.innerHTML = _railsState[rail].map(catId => _renderTile(catId, rail)).join('');
  });
  _attachTileHandlers();
}

function _renderTile(catId, rail) {
  const cat = CATEGORIES_BY_ID[catId];
  if (!cat) return '';
  const activeLayers = _activeLayersIn(catId);
  const hasActive = activeLayers.length > 0;
  const popoutChips = hasActive
    ? activeLayers.map(l =>
        `<div class="np-pop-chip" data-cat="${catId}" data-layer="${l.id}"><span class="np-pop-dot"></span><span class="np-pop-name">${l.name}</span><span class="np-pop-x">\u00D7</span></div>`
      ).join('')
    : '<div class="np-pop-empty">no layers on</div>';
  const iconSvg = NEW_PANEL_ICONS[cat.iconKey] || '';
  return `<button class="np-tile ${hasActive ? 'has-active' : ''}" draggable="true" data-cat="${catId}" data-rail="${rail}">
    <div class="np-tile-icon">${iconSvg}</div>
    <span class="np-tile-label">${cat.label}</span>
    <span class="np-tile-badge" data-cat="${catId}">${activeLayers.length}</span>
    <div class="np-badge-popout">
      <div class="np-pop-eyebrow">${cat.label} \u00B7 active</div>
      ${popoutChips}
    </div>
  </button>`;
}

function _activeLayersIn(catId) {
  return Object.values(LAYERS_BY_ID).filter(l => l.categoryId === catId && layerState[l.id] === true);
}

function _refreshRailState() {
  // Lightweight update: re-render rails so badge counts and has-active reflect new layerState.
  _renderRails();
}

function _attachTileHandlers() {
  document.querySelectorAll('#newpanel-root .np-tile').forEach(tile => {
    tile.addEventListener('click', e => {
      if (e.target.closest('.np-tile-badge') || e.target.closest('.np-badge-popout')) return;
      _openNewPanelModal(tile.dataset.cat);
    });
    tile.addEventListener('dragstart', _onNewPanelDragStart);
    tile.addEventListener('dragend', _onNewPanelDragEnd);

    const badge  = tile.querySelector('.np-tile-badge');
    const popout = tile.querySelector('.np-badge-popout');
    if (badge && popout) {
      badge.addEventListener('mouseenter', e => {
        e.stopPropagation();
        clearTimeout(_newPanelPopoutTimer);
        document.querySelectorAll('#newpanel-root .np-tile.popout-open').forEach(t => {
          if (t !== tile) t.classList.remove('popout-open');
        });
        tile.classList.add('popout-open');
      });
      badge.addEventListener('click', e => {
        e.stopPropagation();
        clearTimeout(_newPanelPopoutTimer);
        tile.classList.toggle('popout-open');
      });
      tile.addEventListener('mouseleave', () => {
        _newPanelPopoutTimer = setTimeout(() => tile.classList.remove('popout-open'), 200);
      });
      popout.addEventListener('mouseenter', () => clearTimeout(_newPanelPopoutTimer));
      popout.addEventListener('mouseleave', () => {
        _newPanelPopoutTimer = setTimeout(() => tile.classList.remove('popout-open'), 200);
      });
      popout.querySelectorAll('.np-pop-x').forEach(x => {
        x.addEventListener('click', async e => {
          e.stopPropagation();
          const chip = e.currentTarget.closest('.np-pop-chip');
          if (chip) {
            await dispatchLayerToggle(chip.dataset.layer);
            if (_activeModalCat) _renderModalCards(_activeModalCat);
          }
        });
      });
      popout.addEventListener('click', e => e.stopPropagation());
    }
  });
}


/* ----------------------------------------------------------
 * DRAG-AND-DROP — ported from v6 mockup verbatim.
 * Same find-target geometry, same swap-on-cross-rail logic.
 * ---------------------------------------------------------- */

function _onNewPanelDragStart(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  _newPanelDragState = {
    cat: e.currentTarget.dataset.cat,
    fromRail: e.currentTarget.dataset.rail,
    width: rect.width,
    height: rect.height
  };
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', _newPanelDragState.cat);
}

function _onNewPanelDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('#newpanel-root .drag-over').forEach(el => el.classList.remove('drag-over'));
  document.querySelectorAll('#newpanel-root .drag-target').forEach(el => el.classList.remove('drag-target'));
  _newPanelDragState = null;
}

function _newPanelDragRect(e) {
  if (!_newPanelDragState) return null;
  return {
    left:   e.clientX - _newPanelDragState.width  / 2,
    right:  e.clientX + _newPanelDragState.width  / 2,
    top:    e.clientY - _newPanelDragState.height / 2,
    bottom: e.clientY + _newPanelDragState.height / 2
  };
}

function _newPanelIntersects(a, b) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function _findActiveRail(e) {
  const dragRect = _newPanelDragRect(e);
  if (!dragRect) return null;
  const topRail  = document.getElementById('np-top-rail');
  const leftRail = document.getElementById('np-left-rail');
  if (!topRail || !leftRail) return null;
  const tr = topRail.getBoundingClientRect();
  const lr = leftRail.getBoundingClientRect();
  if (_newPanelIntersects(dragRect, lr)) return { el: leftRail, name: 'left' };
  if (_newPanelIntersects(dragRect, tr)) return { el: topRail,  name: 'top'  };
  return null;
}

function _findTargetTile(railEl, e, railName) {
  const tiles = Array.from(railEl.querySelectorAll('.np-tile'));
  let best = null, minDist = Infinity;
  for (const t of tiles) {
    if (t.dataset.cat === _newPanelDragState?.cat) continue;
    const r = t.getBoundingClientRect();
    const dist = railName === 'top'
      ? Math.abs(e.clientX - (r.left + r.right) / 2)
      : Math.abs(e.clientY - (r.top  + r.bottom) / 2);
    if (dist < minDist) { minDist = dist; best = t; }
  }
  return best;
}

function _onNewPanelDragOver(e) {
  if (!_newPanelDragState) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('#newpanel-root .drag-over').forEach(el => el.classList.remove('drag-over'));
  document.querySelectorAll('#newpanel-root .drag-target').forEach(el => el.classList.remove('drag-target'));
  const active = _findActiveRail(e);
  if (active) {
    active.el.classList.add('drag-over');
    const target = _findTargetTile(active.el, e, active.name);
    if (target) target.classList.add('drag-target');
  }
}

function _onNewPanelDrop(e) {
  if (!_newPanelDragState) return;
  e.preventDefault();
  const active = _findActiveRail(e);
  if (!active) return;
  const toRail = active.name;
  const fromRail = _newPanelDragState.fromRail;
  const srcCat = _newPanelDragState.cat;
  const targetTile = _findTargetTile(active.el, e, toRail);

  if (fromRail === toRail) {
    if (!targetTile || targetTile.dataset.cat === srcCat) return;
    const arr = _railsState[fromRail].slice();
    const fromIdx = arr.indexOf(srcCat);
    arr.splice(fromIdx, 1);
    let toIdx = arr.indexOf(targetTile.dataset.cat);
    arr.splice(toIdx, 0, srcCat);
    _railsState[fromRail] = arr;
    _saveRailsState();
    _renderRails();
    return;
  }
  // Cross-rail swap (same as v6 mockup).
  const displacedCat = targetTile?.dataset.cat || _railsState[toRail][_railsState[toRail].length - 1];
  const srcArr = _railsState[fromRail].slice();
  const dstArr = _railsState[toRail].slice();
  const srcIdx = srcArr.indexOf(srcCat);
  const dstIdx = dstArr.indexOf(displacedCat);
  srcArr[srcIdx] = displacedCat;
  dstArr[dstIdx] = srcCat;
  _railsState[fromRail] = srcArr;
  _railsState[toRail]   = dstArr;
  _saveRailsState();
  _renderRails();
  requestAnimationFrame(() => {
    const a = document.querySelector(`#newpanel-root .np-tile[data-cat="${srcCat}"]`);
    const b = document.querySelector(`#newpanel-root .np-tile[data-cat="${displacedCat}"]`);
    a?.classList.add('swap-flash');
    b?.classList.add('swap-flash');
    setTimeout(() => { a?.classList.remove('swap-flash'); b?.classList.remove('swap-flash'); }, 600);
  });
  const srcLabel = CATEGORIES_BY_ID[srcCat]?.label || srcCat;
  const dispLabel = CATEGORIES_BY_ID[displacedCat]?.label || displacedCat;
  _newPanelToast(`${srcLabel} \u2192 ${toRail === 'top' ? 'top' : 'side'} rail. ${dispLabel} \u2192 ${fromRail === 'top' ? 'top' : 'side'} rail.`);
}


/* ----------------------------------------------------------
 * MODAL + CARD RENDERING.
 * ---------------------------------------------------------- */

function _openNewPanelModal(catId) {
  _activeModalCat = catId;
  const cat = CATEGORIES_BY_ID[catId];
  if (!cat) return;
  document.getElementById('np-modal-title').textContent = cat.label;
  const layers = _layersIn(catId);
  document.getElementById('np-modal-subtitle').textContent =
    `${layers.length} layer${layers.length === 1 ? '' : 's'} available`;
  _renderModalCards(catId);
  document.getElementById('np-modal-backdrop').classList.add('open');
}

function _closeNewPanelModal() {
  _activeModalCat = null;
  document.getElementById('np-modal-backdrop')?.classList.remove('open');
}

function _layersIn(catId) {
  return Object.values(LAYERS_BY_ID).filter(l => l.categoryId === catId);
}

function _renderModalCards(catId) {
  const grid = document.getElementById('np-card-grid');
  if (!grid) return;
  const cat = CATEGORIES_BY_ID[catId];
  if (!cat) return;

  const subSections = cat.subSections || null;

  if (!subSections || subSections.length === 0) {
    grid.innerHTML = _layersIn(catId).map(_renderCard).join('');
  } else {
    // Render a header per sub-section, then its cards.
    let html = '';
    subSections.forEach(sub => {
      const subLayers = _layersIn(catId).filter(l => l.subSection === sub.id);
      if (subLayers.length === 0) return;
      html += `<div class="np-card-subhead">${sub.label}</div>`;
      html += subLayers.map(_renderCard).join('');
    });
    // Layers without a subSection (rare in current schema)
    const orphans = _layersIn(catId).filter(l => !l.subSection);
    if (orphans.length > 0) html += orphans.map(_renderCard).join('');
    grid.innerHTML = html;
  }

  // Bind clicks
  grid.querySelectorAll('.np-layer-card').forEach(card => {
    card.addEventListener('click', async () => {
      const id = card.dataset.layer;
      await dispatchLayerToggle(id);
      // Re-render this modal so newly-on layer's status text updates.
      _renderModalCards(catId);
    });
  });
}

function _renderCard(l) {
  const isOn = layerState[l.id] === true;
  const isComingSoon = l.behavior === 'comingSoon' || l.comingSoon === true;
  let status;
  if (isComingSoon) status = 'SOON';
  else if (isOn)    status = 'ON \u25CF';
  else              status = '+ ADD';
  const soonPill = isComingSoon ? `<span class="np-card-soon">SOON</span>` : '';

  return `<div class="np-layer-card ${isOn ? 'on' : ''} ${isComingSoon ? 'soon' : ''}" id="card-${l.id}" data-layer="${l.id}">
    <div class="np-card-thumb">${_newPanelThumb(l.thumb)}</div>
    <div class="np-card-body">
      <div class="np-card-title-row">
        <span class="np-card-title" id="card-name-${l.id}">${l.name}</span>
        ${soonPill}
      </div>
      <div class="np-card-desc">${l.desc || ''}</div>
      <div class="np-card-meta">
        <span class="np-card-count">${l.count || ''}</span>
        <span class="np-card-status" id="card-status-${l.id}">${status}</span>
      </div>
    </div>
  </div>`;
}


/* ----------------------------------------------------------
 * TOAST.
 * ---------------------------------------------------------- */

function _newPanelToast(msg) {
  const t = document.getElementById('np-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_newPanelToastTimer);
  _newPanelToastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}


/* ----------------------------------------------------------
 * BOOT — runs on DOMContentLoaded. Gated on ?newpanel=1.
 *
 * Sequence:
 *   1. Detect flag — abort if not set.
 *   2. Add body class so CSS can hide old panel UI.
 *   3. Load schema (fetch layers.json, populate registries).
 *   4. Mount scaffold DOM.
 *   5. Compute rails state (default or from localStorage).
 *   6. Render rails.
 *   7. Hijack toggleLayers() to no-op.
 *   8. Sync any defaultOn layers' visual state (the actual layers
 *      are turned on by addDemoLayers() in app.js — we just mirror).
 * ---------------------------------------------------------- */

async function _bootNewPanel() {
  if (!_isNewPanelEnabled()) return;

  document.body.classList.add('newpanel-on');

  await loadLayerSchema();
  if (Object.keys(LAYERS_BY_ID).length === 0) {
    console.error('[layer-loader] schema empty after load — new panel will not mount');
    return;
  }

  _mountNewPanelScaffold();
  _railsState = _loadRailsState();
  _renderRails();

  // Hijack the gear-button entry point. With new panel always visible,
  // the gear has no role — we intentionally make it a no-op so old code
  // calling toggleLayers() does not pop the legacy panel on top of us.
  if (typeof window !== 'undefined') {
    window.toggleLayers = function () { /* new panel mode — no-op */ };
  }

  // Mirror initial layerState (e.g. active-claims is defaultOn) into card visuals.
  // Cards are not mounted yet (modal closed), but tile badges should reflect counts.
  _renderRails();

  console.info('[layer-loader] new panel mounted (?newpanel=1)');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bootNewPanel);
} else {
  // Already loaded — boot on next tick.
  setTimeout(_bootNewPanel, 0);
}

