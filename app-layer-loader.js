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
 * LAYERS FLYOUT RENDERER — Step 4 of Session 37 desktop UI rebuild
 *
 * Renders the entire #layers-flyout body from layers.json:
 *   - Search bar (filters visible rows by name/desc/info/chipLabel)
 *   - Currently Active section (Step 4 = empty state; Step 5 populates)
 *   - Recipes section (Step 4 = collapsed placeholder; later wires data)
 *   - 10 category sections, collapse state persisted to localStorage
 *   - Sub-sections inside Indicators (Pathfinder, Geochemistry) and
 *     LiDAR (Hillshade, Terrain Tools)
 *   - Layer rows: checkbox + name + count badge + info icon
 *
 * Step 4 scope: rendering + search + collapse only. No layer toggles
 * (Step 5), no opacity sliders (Step 6), no info-panel expansion
 * (later), no Recipes content (later).
 * ============================================================ */

const LAYER_CAT_OPEN_KEY = (catId)        => `ug_layer_cat_${catId}_open`;
const LAYER_SUB_OPEN_KEY = (catId, subId) => `ug_layer_sub_${catId}_${subId}_open`;

function _layersIsCatOpen(catId) {
  try { return localStorage.getItem(LAYER_CAT_OPEN_KEY(catId)) === '1'; } catch (e) { return false; }
}
function _layersIsSubOpen(catId, subId) {
  try { return localStorage.getItem(LAYER_SUB_OPEN_KEY(catId, subId)) !== '0'; } catch (e) { return true; }
}

function _layersEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _layerRowHtml(layer) {
  const soonClass = layer.comingSoon ? 'layer-coming-soon' : '';
  const soonTag   = layer.comingSoon ? '<span class="layer-soon-tag">Soon</span>' : '';
  const countTxt  = (layer.count && !layer.comingSoon) ? `<span class="layer-count">${_layersEscape(layer.count)}</span>` : '';
  const searchTxt = _layersEscape([layer.name, layer.desc, layer.info, layer.chipLabel].filter(Boolean).join(' ').toLowerCase());
  return `<div class="layer-row ${soonClass}" data-layer-id="${_layersEscape(layer.id)}" data-search-text="${searchTxt}">
    <span class="layer-checkbox" aria-hidden="true">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="2 6.5 5 9.5 10 3.5"/>
      </svg>
    </span>
    <span class="layer-name">${_layersEscape(layer.name)}</span>
    ${countTxt}${soonTag}
    <button class="info-btn" type="button" onclick="event.stopPropagation()" aria-label="Layer info">i</button>
  </div>`;
}

function _categorySectionHtml(cat) {
  const layersInCat = Object.values(LAYERS_BY_ID).filter(l => l.categoryId === cat.id);
  const collapsedClass = _layersIsCatOpen(cat.id) ? '' : 'is-collapsed';

  let bodyHtml = '';
  if (cat.subSections && cat.subSections.length) {
    cat.subSections.forEach(sub => {
      const subLayers = layersInCat.filter(l => l.subSection === sub.id);
      const subCollapsed = _layersIsSubOpen(cat.id, sub.id) ? '' : 'is-collapsed';
      bodyHtml += `<div class="subsection ${subCollapsed}" data-subsection="${_layersEscape(cat.id)}|${_layersEscape(sub.id)}">
        <div class="subsection-header" onclick="toggleLayerSubsection('${_layersEscape(cat.id)}','${_layersEscape(sub.id)}')">
          <span class="subsection-title">${_layersEscape(sub.label)}</span>
          <span class="category-count">${subLayers.length}</span>
          <span class="category-arrow">▼</span>
        </div>
        <div class="subsection-body">${subLayers.map(_layerRowHtml).join('')}</div>
      </div>`;
    });
    // Loose layers that don't belong to any declared sub-section
    const loose = layersInCat.filter(l => !l.subSection);
    bodyHtml += loose.map(_layerRowHtml).join('');
  } else {
    bodyHtml += layersInCat.map(_layerRowHtml).join('');
  }

  return `<div class="category-section ${collapsedClass}" data-category="${_layersEscape(cat.id)}">
    <div class="category-header" onclick="toggleLayerCategory('${_layersEscape(cat.id)}')">
      <span class="category-title">${_layersEscape(cat.label)}</span>
      <span class="category-count">${layersInCat.length}</span>
      <span class="category-active-count">(0)</span>
      <span class="category-arrow">▼</span>
    </div>
    <div class="category-body">${bodyHtml}</div>
  </div>`;
}

function renderLayersFlyout() {
  const body = document.querySelector('#layers-flyout .flyout-body');
  if (!body) return;
  if (!CATEGORIES_BY_ID || Object.keys(CATEGORIES_BY_ID).length === 0) return;

  let html = '';
  // Search
  html += `<div class="layers-search">
    <input id="layers-search-input" type="text" placeholder="Search layers..." autocomplete="off">
  </div>`;
  // Currently Active (Step 4 — empty state; Step 5 populates the list)
  html += `<div class="currently-active-section">
    <div class="currently-active-header">Currently Active <span id="active-layer-count">(0)</span></div>
    <div id="active-layers-list">
      <div class="layers-empty-state">No layers active — tap a category below to start.</div>
    </div>
    <div class="layers-actions" id="active-layers-actions" style="display:none">
      <button class="hide-all-btn" type="button">Hide All</button>
      <button class="clear-all-btn" type="button">Clear All</button>
    </div>
  </div>`;
  // Recipes (Step 4 — collapsed placeholder)
  html += `<div class="category-section is-collapsed" data-category="__recipes">
    <div class="category-header" onclick="toggleLayerCategory('__recipes')">
      <span class="category-title">Recipes</span>
      <span class="category-arrow">▼</span>
    </div>
    <div class="category-body"><div class="layers-empty-state" style="padding:8px 14px">Curated recipes coming soon.</div></div>
  </div>`;
  // 10 Categories
  Object.values(CATEGORIES_BY_ID).forEach(cat => { html += _categorySectionHtml(cat); });

  body.innerHTML = html;

  // Wire search input — filters visible rows by data-search-text
  const searchInput = document.getElementById('layers-search-input');
  if (searchInput) searchInput.addEventListener('input', _onLayersSearch);

  console.info(`[layers-flyout] rendered ${Object.keys(LAYERS_BY_ID).length} layers across ${Object.keys(CATEGORIES_BY_ID).length} categories`);
}

function toggleLayerCategory(catId) {
  const sec = document.querySelector(`.category-section[data-category="${catId}"]`);
  if (!sec) return;
  const willOpen = sec.classList.contains('is-collapsed');
  sec.classList.toggle('is-collapsed', !willOpen);
  if (catId !== '__recipes') {
    try { localStorage.setItem(LAYER_CAT_OPEN_KEY(catId), willOpen ? '1' : '0'); } catch (e) {}
  }
}

function toggleLayerSubsection(catId, subId) {
  const sec = document.querySelector(`.subsection[data-subsection="${catId}|${subId}"]`);
  if (!sec) return;
  const willOpen = sec.classList.contains('is-collapsed');
  sec.classList.toggle('is-collapsed', !willOpen);
  try { localStorage.setItem(LAYER_SUB_OPEN_KEY(catId, subId), willOpen ? '1' : '0'); } catch (e) {}
}

// Search filter — empty/<3 chars shows everything; 3+ filters layer rows
// by lowercase substring match against data-search-text and hides
// (sub)sections that contain no visible rows.
function _onLayersSearch(e) {
  const q = e.target.value.trim().toLowerCase();
  const rows        = document.querySelectorAll('#layers-flyout .layer-row');
  const subsections = document.querySelectorAll('#layers-flyout .subsection');
  const categories  = document.querySelectorAll('#layers-flyout .category-section[data-category]:not([data-category="__recipes"])');
  const recipesSec  = document.querySelector('#layers-flyout .category-section[data-category="__recipes"]');

  if (q.length < 3) {
    rows.forEach(el => el.style.display = '');
    subsections.forEach(el => el.style.display = '');
    categories.forEach(el => el.style.display = '');
    if (recipesSec) recipesSec.style.display = '';
    return;
  }

  rows.forEach(el => {
    el.style.display = (el.getAttribute('data-search-text') || '').includes(q) ? '' : 'none';
  });
  subsections.forEach(sec => {
    const hasVisible = sec.querySelectorAll('.layer-row:not([style*="display: none"])').length > 0;
    sec.style.display = hasVisible ? '' : 'none';
  });
  categories.forEach(sec => {
    const hasVisible = sec.querySelectorAll('.layer-row:not([style*="display: none"])').length > 0;
    sec.style.display = hasVisible ? '' : 'none';
    // Auto-expand categories that contain matches so the user sees them
    if (hasVisible) sec.classList.remove('is-collapsed');
  });
  // Recipes is hidden during active search since it has no rows to match
  if (recipesSec) recipesSec.style.display = 'none';
}


/* ----------------------------------------------------------
 * BOOT — preload schema, then render the Layers flyout body.
 * ---------------------------------------------------------- */
async function _initLayersUI() {
  await loadLayerSchema();
  renderLayersFlyout();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initLayersUI);
} else {
  setTimeout(_initLayersUI, 0);
}

