// ==========================================================
// app.js — Unworked Gold main application JavaScript
// Extracted from index.html main <script> block, Session 7 (April 19, 2026)
// Original location: index.html lines 940-5016
//
// LOAD ORDER NOTE: this file must load AFTER:
//   1. The inline <script> config block (sets window.UNWORKED_GOLD_CONFIG)
//   2. Supabase CDN script (sets window.supabase)
// Mapbox GL JS is loaded dynamically at runtime when the user's
// token is supplied, so it does not need to be present when app.js loads.
//
// GLOBAL SCOPE: all functions here are plain `function` declarations,
// which become window properties. Inline onclick="..." handlers in
// index.html resolve via those globals.
// ==========================================================

let map = null;
let userLocation = null; // { lng, lat } set when user hits GPS button

// Haversine distance in miles between two lat/lng points
function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

let layerState = {
  'active-claims': true,
  'placer-claims': false,
  'lode-claims': false,
  'tunnel-claims': false,
  'mill-claims': false,
  'closed-claims': false,
  'open-land': false,
  'open-to-claim': false,
  'plss': false,
  'blm-roads': false,
  'terrain-3d': false,
  'contours': false,
  'gold-occurrences': false,
  'hist-mines': false,
  'mercury': false,
  'chromium': false,
  'copper': false,
  'antimony': false,
  'silver': false,
  'natl-parks': false,
  'wilderness': false,
  'stream-gauges': false,
  'monuments': false,
  'wild-scenic': false,
  'tribal': false,
  'military': false,
  'placer-heatmap': false,
  'lode-heatmap': false,
  'placer-density': false
};


let layerPanelOpen = false;
let styleSwitcherOpen = false;
let findPanelOpen = false;
let aiMenuOpen = false;
const FREE_ROCK_ID_LIMIT = 3;
let currentStyle = 'satellite';

const styles = {
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  terrain: 'mapbox://styles/mapbox/outdoors-v12',
  // Topo uses a minimal Mapbox frame; the actual topographic content
  // is the USGS National Map Topo raster overlay added in setStyle()
  // when name === 'topo'. See Finding #7c (Session 24).
  topo: 'mapbox://styles/mapbox/light-v11'
};

function initMap() {
  const token = document.getElementById('token-input').value.trim();
  if (!token || !token.startsWith('pk.')) return;
  localStorage.setItem('unworked_gold_mapbox_token', token);
  if (typeof mapboxgl === 'undefined') {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js';
    script.onload = () => startMap(token);
    script.onerror = () => console.error('Mapbox failed to load');
    document.head.appendChild(script);
    return;
  }
  startMap(token);
}


function startMap(token) {
  mapboxgl.accessToken = token;

  map = new mapboxgl.Map({
    container: 'map',
    style: styles.satellite,
    center: [-120.5, 43.8], // Oregon
    zoom: 10,
    pitch: 0,
    bearing: 0,
    antialias: true
  });
  window.map = map; // expose for cross-module access (zoom cluster, theme map style)

  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false, showCompass: false }), 'top-left');
  map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

  map.on('load', () => {
    // Add terrain source (used only when 3D is toggled on)
    map.addSource('mapbox-dem', {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom: 14
    });

    // Force completely flat on load
    map.setPitch(0);
    map.setBearing(0);
    map.setTerrain(null);

    addDemoLayers();
    showStatus('Map loaded — Oregon Mining Claims');
    initSupabase();
    initDrawSearch();

    // Fly to location requested from dashboard
    const flyReq = localStorage.getItem('unworked_gold_fly_to') || localStorage.getItem('prospector_fly_to');
    if (flyReq) {
      try {
        const { lng, lat, zoom } = JSON.parse(flyReq);
        localStorage.removeItem('unworked_gold_fly_to');
        localStorage.removeItem('prospector_fly_to');
        setTimeout(() => map.flyTo({ center: [lng, lat], zoom: zoom || 14, pitch: 45 }), 800);
      } catch(e) {}
    }

    // Reload MRDS layers when map pans/zooms — debounced 800ms
    let mrdsReloadTimer = null;
    map.on('moveend', () => {
      const anyMrds = layerState['gold-occurrences'] || layerState['hist-mines'] ||
        layerState['mercury'] || layerState['chromium'] ||
        layerState['copper'] || layerState['antimony'] || layerState['silver'] ||
        layerState['placer-heatmap'] || layerState['lode-heatmap'];
      if (!anyMrds) return;
      clearTimeout(mrdsReloadTimer);
      mrdsReloadTimer = setTimeout(() => {
        if (layerState['gold-occurrences'] || layerState['placer-heatmap']) fetchGoldOccurrences(true);
        if (layerState['hist-mines'] || layerState['lode-heatmap']) fetchHistoricMines(true);
        if (layerState['mercury']) fetchMercury(true);
        if (layerState['chromium']) fetchChromium(true);
        if (layerState['copper']) fetchCopper(true);
        if (layerState['antimony']) fetchAntimony(true);
        if (layerState['silver']) fetchSilver(true);
      }, 800);
    });

    // Update compass arrow rotation
    map.on('rotate', () => {
      const bearing = map.getBearing();
      const arrow = document.getElementById('compass-arrow');
      if (arrow) arrow.style.transform = `rotate(${bearing}deg)`;
    });

    // Update coordinate display on every move.
    // Two sinks: legacy #coord-display (hidden, kept for back-compat) and
    // the Step-2 #topbar-coords readout (visible, spec format
    // "39.987\u00b0N \u00b7 118.518\u00b0W \u00b7 z10.4" \u2014 3-decimal lat/lng, 1-decimal zoom).
    const coordEl       = document.getElementById('coord-display');
    const topbarCoordEl = document.getElementById('topbar-coords');
    const updateCoords = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      const latLegacy = c.lat >= 0 ? c.lat.toFixed(5) + '\u00b0N' : Math.abs(c.lat).toFixed(5) + '\u00b0S';
      const lngLegacy = c.lng >= 0 ? c.lng.toFixed(5) + '\u00b0E' : Math.abs(c.lng).toFixed(5) + '\u00b0W';
      if (coordEl) coordEl.textContent = latLegacy + '  ' + lngLegacy + '  z' + z.toFixed(1);

      const lat3 = c.lat >= 0 ? c.lat.toFixed(3) + '\u00b0N' : Math.abs(c.lat).toFixed(3) + '\u00b0S';
      const lng3 = c.lng >= 0 ? c.lng.toFixed(3) + '\u00b0E' : Math.abs(c.lng).toFixed(3) + '\u00b0W';
      if (topbarCoordEl) topbarCoordEl.textContent = lat3 + ' \u00b7 ' + lng3 + ' \u00b7 z' + z.toFixed(1);
    };
    map.on('move', updateCoords);
    updateCoords();

    terrain3DOn = false;
  });

  map.on('click', (e) => {
    const { lng, lat } = e.lngLat;
    showStatus(`${lat.toFixed(5)}°N  ${lng.toFixed(5)}°W`);
  });

  // Touch long press for mobile only (not mouse)
  let touchTimer = null;
  let touchMoved = false;

  map.getCanvas().addEventListener('touchstart', (e) => {
    if (drawMode) return;
    touchMoved = false;
    const touch = e.touches[0];
    touchTimer = setTimeout(() => {
      if (!touchMoved) {
        const point = map.unproject([touch.clientX, touch.clientY]);
        openSpotPanel(point.lng, point.lat);
      }
    }, 700);
  }, { passive: true });

  map.getCanvas().addEventListener('touchmove', () => {
    touchMoved = true;
    clearTimeout(touchTimer);
  }, { passive: true });

  map.getCanvas().addEventListener('touchend', () => clearTimeout(touchTimer), { passive: true });
}

function setStyle(name) {
  if (!map) return;
  currentStyle = name;
  document.querySelectorAll('.style-btn').forEach((b, i) => {
    b.classList.toggle('active', b.textContent.toLowerCase() === name);
  });
  map.setStyle(styles[name]);
  map.once('style.load', () => {
    map.addSource('mapbox-dem', {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom: 14
    });
    setTerrain3D(layerState['terrain-3d']);

    // USGS Topo overlay — only when 'topo' basemap is selected.
    // Public ArcGIS XYZ tile service from The National Map. Web Mercator,
    // 256px, no auth, US-only coverage. Caches up to ~zoom 17. See
    // Finding #7c (Session 24). Layer is wiped automatically on next
    // setStyle() call since Mapbox setStyle() destroys all custom layers.
    if (name === 'topo') {
      map.addSource('usgs-topo-src', {
        type: 'raster',
        tiles: ['https://basemap.nationalmap.gov/ArcGIS/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: 'USGS The National Map'
      });
      map.addLayer({
        id: 'usgs-topo-layer',
        type: 'raster',
        source: 'usgs-topo-src',
        paint: { 'raster-opacity': 1.0 }
      });
    }

    addDemoLayers();
  });
  showStatus(`Style: ${name}`);
}

function locateUser() {
  if (!map) return;
  if (!navigator.geolocation) { showStatus('Geolocation not available'); return; }
  showStatus('Getting location...');
  navigator.geolocation.getCurrentPosition(pos => {
    const { longitude, latitude } = pos.coords;
    userLocation = { lng: longitude, lat: latitude };
    map.flyTo({ center: [longitude, latitude], zoom: 13, pitch: 0 });
    new mapboxgl.Marker({ color: '#F0C040' })
      .setLngLat([longitude, latitude])
      .addTo(map);
    showStatus(`Located: ${latitude.toFixed(4)}°N`);
  }, () => showStatus('Location permission denied'));
}

function openFindPanel() {
  findPanelOpen = true;
  document.getElementById('find-panel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}

function closeAllPanels() {
  findPanelOpen = false;
  document.getElementById('claim-panel').classList.remove('open');
  document.getElementById('find-panel').classList.remove('open');
  document.getElementById('spot-panel').classList.remove('open');
  document.getElementById('auth-panel').classList.remove('open');
  document.getElementById('account-panel').classList.remove('open');
  document.getElementById('feedback-panel').classList.remove('open');
  document.getElementById('rock-id-panel').classList.remove('open');
  document.getElementById('outcrop-panel').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
  if (aiMenuOpen) closeAIMenu();
}

let feedbackType = 'bug';
function selectFeedbackType(el, type) {
  feedbackType = type;
  document.querySelectorAll('.feedback-type-btn').forEach((b) => b.classList.remove('active'));
  if (el) el.classList.add('active');
}

function openFeedbackPanel() {
  document.getElementById('feedback-error').style.display = 'none';
  document.getElementById('feedback-panel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}

function closeFeedbackPanel() {
  document.getElementById('feedback-panel').classList.remove('open');
}

async function submitFeedback() {
  const msgEl = document.getElementById('feedback-message');
  const errEl = document.getElementById('feedback-error');
  const submitBtn = document.getElementById('feedback-submit-btn');
  const message = (msgEl?.value || '').trim();

  errEl.style.display = 'none';
  if (!message) {
    errEl.textContent = 'Please add a note before sending.';
    errEl.style.display = 'block';
    return;
  }
  if (!sbClient) {
    errEl.textContent = 'Feedback service is not ready yet. Please refresh and try again.';
    errEl.style.display = 'block';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.style.opacity = '0.7';

  try {
    const center = map ? map.getCenter() : null;
    const zoom = map ? Number(map.getZoom().toFixed(2)) : null;
    const camera = map ? { bearing: map.getBearing(), pitch: map.getPitch() } : null;
    const bounds = map ? map.getBounds() : null;
    const activeLayerIds = Object.entries(layerState || {})
      .filter(([, isOn]) => !!isOn)
      .map(([layerId]) => layerId);
    const session = sbClient?.auth ? await sbClient.auth.getSession() : { data: { session: null } };
    const sessionUser = session?.data?.session?.user || null;
    const pagePath = window.location.pathname || '/index.html';

    const sessionMeta = {
      session_status: currentUser ? 'authenticated' : 'anonymous',
      gps_state: userLocation ? 'enabled' : 'disabled',
      viewport_width: window.innerWidth || null,
      viewport_height: window.innerHeight || null,
      device_pixel_ratio: window.devicePixelRatio || null,
      language: navigator.language || null,
      timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone || null),
      release_channel: 'beta',
      auth_user_id: sessionUser?.id || null
    };

    const payload = {
      type: feedbackType,
      message,
      map_zoom: zoom,
      map_lat: center ? Number(center.lat.toFixed(6)) : null,
      map_lng: center ? Number(center.lng.toFixed(6)) : null,
      page_path: pagePath,
      app_section: 'map',
      map_style: currentStyle || null,
      current_url: window.location.href,
      referrer: document.referrer || null,
      has_gps_fix: !!userLocation,
      camera_pitch: camera ? Number(camera.pitch.toFixed(3)) : null,
      camera_bearing: camera ? Number(camera.bearing.toFixed(3)) : null,
      map_bounds_sw_lat: bounds ? Number(bounds.getSouth().toFixed(6)) : null,
      map_bounds_sw_lng: bounds ? Number(bounds.getWest().toFixed(6)) : null,
      map_bounds_ne_lat: bounds ? Number(bounds.getNorth().toFixed(6)) : null,
      map_bounds_ne_lng: bounds ? Number(bounds.getEast().toFixed(6)) : null,
      map_bearing: camera ? Number(camera.bearing.toFixed(3)) : null,
      map_pitch: camera ? Number(camera.pitch.toFixed(3)) : null,
      active_layers: activeLayerIds,
      viewport_width: window.innerWidth || null,
      viewport_height: window.innerHeight || null,
      device_pixel_ratio: window.devicePixelRatio || null,
      language: navigator.language || null,
      timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone || null),
      release_channel: 'beta',
      session_id: session?.data?.session?.access_token
        ? session.data.session.access_token.slice(0, 16)
        : null,
      session_meta: sessionMeta,
      user_agent: navigator.userAgent
    };
    if (currentUser?.id) payload.user_id = currentUser.id;

    let insertResult = await sbClient.from('beta_feedback').insert(payload);
    if (insertResult.error) {
      // Backward-compatible fallback for environments with older beta_feedback schema.
      const fallbackPayload = {
        type: feedbackType,
        message,
        map_zoom: zoom,
        map_lat: center ? Number(center.lat.toFixed(6)) : null,
        map_lng: center ? Number(center.lng.toFixed(6)) : null,
        user_agent: navigator.userAgent
      };
      if (currentUser?.id) fallbackPayload.user_id = currentUser.id;
      insertResult = await sbClient.from('beta_feedback').insert(fallbackPayload);
      if (insertResult.error) throw insertResult.error;
    }

    msgEl.value = '';
    closeAllPanels();
    showStatus('Feedback received — thank you.');
  } catch (e) {
    console.error('feedback submit failed', e);
    errEl.textContent = 'Could not send feedback. Please try again.';
    errEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
  }
}

function resetBearing() {
  if (!map) return;
  map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
}

let terrain3DOn = false;

// ── 3D TERRAIN — SINGLE SOURCE OF TRUTH ─────────────────
// All paths that turn 3D terrain on or off route through here:
//   • toggle3D()                — floating "3D" button
//   • toggleLayer('terrain-3d') — Layer Panel row (in app-layers.js)
//   • setStyle()                — basemap re-init after style.load
// Updates in lockstep:
//   • map.setTerrain + camera ease
//   • global terrain3DOn flag
//   • layerState['terrain-3d']
//   • #terrain-toggle-btn (floating button) "active" class
//   • #bullet-terrain-3d / #name-terrain-3d / #toggle-terrain-3d
//     (Layer Panel row visuals + hidden compat toggle)
function setTerrain3D(on) {
  if (!map) return;
  const next = !!on;
  terrain3DOn = next;
  layerState['terrain-3d'] = next;

  if (next) {
    map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.6 });
    map.easeTo({ pitch: 55, duration: 600 });
  } else {
    map.setTerrain(null);
    map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  }

  const btn = document.getElementById('terrain-toggle-btn');
  if (btn) btn.classList.toggle('active', next);

  const bullet = document.getElementById('bullet-terrain-3d');
  const name   = document.getElementById('name-terrain-3d');
  const tgl    = document.getElementById('toggle-terrain-3d');
  if (bullet) bullet.classList.toggle('on', next);
  if (name)   name.classList.toggle('on', next);
  if (tgl)    tgl.classList.toggle('on', next);
}

function toggle3D() {
  if (!map) return;
  setTerrain3D(!terrain3DOn);
  showStatus(terrain3DOn ? '3D terrain on' : 'Flat map');
}

function updateRestrictionLegend() {
  const legend = document.getElementById('restriction-legend');
  if (!legend) return;
  const anyOn = layerState['natl-parks'] || layerState['wilderness'] || layerState['open-land'] || 
    layerState['open-to-claim'] || layerState['monuments'] || layerState['wild-scenic'] || layerState['tribal'];
  legend.style.display = anyOn ? 'block' : 'none';
}

// ── GOLD SPOT PRICE ─────────────────────────────────────
// Per-session previous price for the top-bar tick. Reset on page load
// per spec ("don't persist tick state across page loads").
let _topbarLastAuPrice = null;

function _renderTopbarAu(price) {
  const auEl = document.getElementById('topbar-au');
  if (!auEl) return;
  if (price == null) {
    auEl.classList.add('empty');
    auEl.textContent = 'Au —';
    return;
  }
  const rounded = Math.round(Number(price));
  const fmt     = rounded.toLocaleString('en-US');
  auEl.classList.remove('empty');
  let tickHtml = '';
  if (_topbarLastAuPrice != null && rounded !== _topbarLastAuPrice) {
    const dir = rounded > _topbarLastAuPrice ? 'up' : 'down';
    const arrow = dir === 'up' ? '▲' : '▼';
    tickHtml = `<span class="topbar-au-tick ${dir}">${arrow}</span>`;
  }
  auEl.innerHTML = 'Au $' + fmt + tickHtml;
  _topbarLastAuPrice = rounded;
}

async function fetchGoldPrice() {
  const valEl    = document.getElementById('gold-price-value');
  const changeEl = document.getElementById('gold-price-change');
  const tsEl     = document.getElementById('gold-price-ts');
  if (valEl) valEl.textContent = '...';
  try {
    // metals.live — free, no key, browser-safe
    const res  = await fetch('https://api.metals.live/v1/spot/gold');
    const data = await res.json();
    const price = Array.isArray(data) ? data[0]?.price : data?.price;
    if (price) {
      const fmt = Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (valEl) valEl.textContent = '$' + fmt;
      localStorage.setItem('unworked_gold_gold_price', fmt);
      localStorage.setItem('unworked_gold_gold_price_ts', Date.now().toString());
      if (changeEl) { changeEl.textContent = ''; changeEl.className = ''; }
      const now = new Date();
      if (tsEl) tsEl.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      _renderTopbarAu(price);
      return;
    }
  } catch(e) { /* fall through to backup */ }
  try {
    // Backup: goldprice.org data endpoint
    const res2  = await fetch('https://data-asg.goldprice.org/dbXRates/USD');
    const d2    = await res2.json();
    const price2 = d2?.items?.[0]?.xauPrice;
    if (price2) {
      if (valEl) valEl.textContent = '$' + Number(price2).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (tsEl) tsEl.textContent = 'live';
      _renderTopbarAu(price2);
      return;
    }
  } catch(e2) { /* ignore */ }
  if (valEl) valEl.textContent = '—';
  if (tsEl) tsEl.textContent = '';
  _renderTopbarAu(null);   // P1.14: endpoint broken — show greyed "Au —"
}


function showStatus(msg) {
  const pill = document.getElementById('status-pill');
  pill.textContent = msg;
  pill.classList.add('show');
  clearTimeout(pill._t);
  pill._t = setTimeout(() => pill.classList.remove('show'), 2800);
}



// ── TOP BAR ACCOUNT MENU (Step 2) ────────────────────────
// Click the account button to open/close the dropdown. Items shown
// depend on currentUser: signed-out gets Sign In + Feedback, signed-in
// gets Dashboard / Billing / Settings / Feedback / Sign Out. Refreshed
// from refreshTopbarAccount() on every auth-state change in app-auth.js.
function toggleAccountMenu(ev) {
  if (ev) ev.stopPropagation();
  const menu = document.getElementById('topbar-account-menu');
  if (!menu) return;
  const isOpen = menu.classList.toggle('open');
  menu.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}

function closeAccountMenu() {
  const menu = document.getElementById('topbar-account-menu');
  if (!menu) return;
  menu.classList.remove('open');
  menu.setAttribute('aria-hidden', 'true');
}

// Show/hide menu items based on currentUser. Also swap the account
// button between signed-in (icon) and signed-out (text "Sign In") modes.
// Called from app-auth.js auth-state callbacks.
function refreshTopbarAccount() {
  const signedIn = !!(typeof currentUser !== 'undefined' && currentUser);
  const menu = document.getElementById('topbar-account-menu');
  if (menu) {
    menu.querySelectorAll('[data-when]').forEach(el => {
      const when = el.getAttribute('data-when');
      const show = when === 'both'
        || (when === 'signed-in' && signedIn)
        || (when === 'signed-out' && !signedIn);
      el.style.display = show ? '' : 'none';
    });
    const emailEl = document.getElementById('topbar-account-email');
    if (emailEl) {
      if (signedIn && currentUser?.email) {
        emailEl.textContent = currentUser.email;
        emailEl.style.display = 'block';
      } else {
        emailEl.style.display = 'none';
      }
    }
  }
  const btn = document.getElementById('topbar-account-btn');
  if (btn) {
    if (signedIn) {
      btn.classList.remove('signed-out');
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21 c0 -5 4 -8 8 -8 s8 3 8 8"/></svg>';
    } else {
      btn.classList.add('signed-out');
      btn.textContent = 'Sign In';
    }
  }
}

// Dismiss the dropdown on outside click.
document.addEventListener('click', (e) => {
  const menu = document.getElementById('topbar-account-menu');
  const btn  = document.getElementById('topbar-account-btn');
  if (!menu || !menu.classList.contains('open')) return;
  if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
  closeAccountMenu();
});

// Dashboard / Billing / Settings entry points. Open in a new tab so the
// map session isn't lost. dashboard.html reads ?tab= to pre-select.
function openDashboard() { closeAccountMenu(); window.open('dashboard.html', '_blank'); }
function openBilling()   { closeAccountMenu(); window.open('dashboard.html?tab=billing', '_blank'); }
function openSettings()  { closeAccountMenu(); window.open('dashboard.html?tab=preferences', '_blank'); }


// ── LEFT RAIL FLYOUTS (Step 3) ───────────────────────────
// One-flyout-at-a-time. toggleFlyout(name) opens or closes the named
// flyout; clicking another rail button while one is open closes the
// current and opens the new one. ESC and outside-click also close.
// Map narrows via body.flyout-open class (CSS sets #map left:416px);
// after the 200ms slide we call map.resize() so Mapbox re-pages tiles.
let _activeFlyout = null;

function toggleFlyout(name) {
  if (_activeFlyout === name) {
    closeFlyouts();
  } else {
    openFlyout(name);
  }
}

function openFlyout(name) {
  // Close any currently-open flyout first (one-at-a-time rule)
  document.querySelectorAll('.flyout.open').forEach(el => {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  });
  document.querySelectorAll('.rail-btn.active').forEach(el => el.classList.remove('active'));

  const fly = document.getElementById(name + '-flyout');
  const btn = document.querySelector(`.rail-btn[data-flyout="${name}"]`);
  if (!fly || !btn) {
    console.warn('[flyout] unknown flyout name:', name);
    return;
  }
  fly.classList.add('open');
  fly.setAttribute('aria-hidden', 'false');
  btn.classList.add('active');
  document.body.classList.add('flyout-open');
  _activeFlyout = name;

  // Repaint Mapbox after the 200ms slide finishes so tiles match the
  // narrowed container width.
  setTimeout(() => { if (window.map && window.map.resize) window.map.resize(); }, 220);
}

function closeFlyouts() {
  if (!_activeFlyout) return;
  document.querySelectorAll('.flyout.open').forEach(el => {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  });
  document.querySelectorAll('.rail-btn.active').forEach(el => el.classList.remove('active'));
  document.body.classList.remove('flyout-open');
  _activeFlyout = null;
  setTimeout(() => { if (window.map && window.map.resize) window.map.resize(); }, 220);
}

// ESC closes any open flyout.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _activeFlyout) closeFlyouts();
});

// Outside-click closes any open flyout. Coexists with the account-menu
// outside-click handler (different scope: that one only fires when the
// account menu is open).
document.addEventListener('click', (e) => {
  if (!_activeFlyout) return;
  const fly  = document.getElementById(_activeFlyout + '-flyout');
  const rail = document.getElementById('left-rail');
  if (fly && fly.contains(e.target)) return;
  if (rail && rail.contains(e.target)) return;
  closeFlyouts();
});


// ── BOOT: read mapbox token from inline config, init map ──
// Previously fetched from Supabase app_config table; that table was
// dropped in Session 29 security hardening. Mapbox public tokens (pk.*)
// are inlined directly in window.UNWORKED_GOLD_CONFIG (index.html).
window.addEventListener('load', () => {
  // Prime the top-bar account menu in signed-out state. app-auth.js will
  // call refreshTopbarAccount() again once Supabase resolves a session.
  refreshTopbarAccount();

  // Kick off the gold-price fetch. Endpoint is currently broken (P1.14);
  // failure path renders "Au —" greyed via _renderTopbarAu(null).
  fetchGoldPrice();

  const token =
    window.UNWORKED_GOLD_CONFIG?.mapbox_token ||
    window.PROSPECTOR_CONFIG?.mapbox_token ||
    localStorage.getItem('unworked_gold_mapbox_token') ||
    localStorage.getItem('prospector_mapbox_token');
  if (token && token.startsWith('pk.')) {
    document.getElementById('token-input').value = token;
    initMap();
  }
});
