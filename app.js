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
  'terrain-3d': true,
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
let anthropicKey = null;
const FREE_ROCK_ID_LIMIT = 3;
let currentStyle = 'satellite';

const styles = {
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  terrain: 'mapbox://styles/mapbox/outdoors-v12',
  topo: 'mapbox://styles/mapbox/outdoors-v12'
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
    initFABDrag();

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

    // Update coordinate display on every move
    const coordEl = document.getElementById('coord-display');
    const updateCoords = () => {
      if (!coordEl) return;
      const c = map.getCenter();
      const lat = c.lat >= 0 ? c.lat.toFixed(5) + '\u00b0N' : Math.abs(c.lat).toFixed(5) + '\u00b0S';
      const lng = c.lng >= 0 ? c.lng.toFixed(5) + '\u00b0E' : Math.abs(c.lng).toFixed(5) + '\u00b0W';
      coordEl.textContent = lat + '  ' + lng + '  z' + map.getZoom().toFixed(1);
      const zEl = document.getElementById('zoom-readout');
      if (zEl) zEl.textContent = 'z' + map.getZoom().toFixed(1);
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

function toggleStyles() {
  styleSwitcherOpen = !styleSwitcherOpen;
  document.getElementById('style-switcher').classList.toggle('open', styleSwitcherOpen);
  document.getElementById('style-btn').classList.toggle('active', styleSwitcherOpen);
  if (layerPanelOpen) toggleLayers();
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
    if (layerState['terrain-3d']) {
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.6 });
    } else {
      map.setTerrain(null);
      map.setPitch(0);
      map.setBearing(0);
    }
    addDemoLayers();
  });
  toggleStyles();
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

function openSpotFromFAB() {
  if (!map) return;
  const center = map.getCenter();
  openSpotPanel(center.lng, center.lat);
}

function initFABDrag() {
  const fab = document.getElementById('fab');
  let isDragging = false;
  let startX, startY, fabStartX, fabStartY;
  let dragMoved = false;

  fab.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = fab.getBoundingClientRect();
    fabStartX = rect.left;
    fabStartY = rect.top;
    fab.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragMoved = true;
    fab.style.position = 'fixed';
    fab.style.left = (fabStartX + dx) + 'px';
    fab.style.top = (fabStartY + dy) + 'px';
    fab.style.bottom = 'auto';
    fab.style.right = 'auto';
  });

  document.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    fab.classList.remove('dragging');

    if (!dragMoved) {
      // Simple tap - open spot panel at center
      resetFABPosition();
      openSpotFromFAB();
      return;
    }

    // Drop pin at cursor position
    const mapCanvas = map.getCanvas();
    const rect = mapCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
      const point = map.unproject([x, y]);
      resetFABPosition();
      openSpotPanel(point.lng, point.lat);
    } else {
      resetFABPosition();
      showStatus('Drop pin on the map');
    }
  });
}

function resetFABPosition() {
  const fab = document.getElementById('fab');
  fab.style.position = 'absolute';
  fab.style.left = 'auto';
  fab.style.top = 'auto';
  fab.style.bottom = '88px';
  fab.style.right = '20px';
}

function closeAllPanels() {
  findPanelOpen = false;
  layerPanelOpen = false;
  document.getElementById('layer-panel').classList.remove('open');
  document.getElementById('layer-btn').classList.remove('active');
  document.getElementById('claim-panel').classList.remove('open');
  document.getElementById('find-panel').classList.remove('open');
  document.getElementById('spot-panel').classList.remove('open');
  document.getElementById('auth-panel').classList.remove('open');
  document.getElementById('account-panel').classList.remove('open');
  document.getElementById('feedback-panel').classList.remove('open');
  document.getElementById('rock-id-panel').classList.remove('open');
  document.getElementById('outcrop-panel').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
  if (styleSwitcherOpen) toggleStyles();
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
function toggle3D() {
  if (!map) return;
  terrain3DOn = !terrain3DOn;
  const btn = document.getElementById('terrain-toggle-btn');
  btn.classList.toggle('active', terrain3DOn);
  if (terrain3DOn) {
    map.easeTo({ pitch: 55, duration: 600 });
    map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.6 });
    layerState['terrain-3d'] = true;
    document.getElementById('toggle-terrain-3d').classList.add('on');
  } else {
    map.easeTo({ pitch: 0, duration: 600 });
    map.setTerrain(null);
    layerState['terrain-3d'] = false;
    document.getElementById('toggle-terrain-3d').classList.remove('on');
  }
  showStatus(terrain3DOn ? '3D terrain on' : 'Flat map');
}

function setNav(el) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el.classList.add('active');
}

function updateRestrictionLegend() {
  const legend = document.getElementById('restriction-legend');
  if (!legend) return;
  const anyOn = layerState['natl-parks'] || layerState['wilderness'] || layerState['open-land'] || 
    layerState['open-to-claim'] || layerState['monuments'] || layerState['wild-scenic'] || layerState['tribal'];
  legend.style.display = anyOn ? 'block' : 'none';
}

// ── GOLD SPOT PRICE ─────────────────────────────────────
async function fetchGoldPrice() {
  const valEl    = document.getElementById('gold-price-value');
  const changeEl = document.getElementById('gold-price-change');
  const tsEl     = document.getElementById('gold-price-ts');
  if (!valEl) return;
  valEl.textContent = '...';
  try {
    // metals.live — free, no key, browser-safe
    const res  = await fetch('https://api.metals.live/v1/spot/gold');
    const data = await res.json();
    const price = Array.isArray(data) ? data[0]?.price : data?.price;
    if (price) {
      const fmt = Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      valEl.textContent = '$' + fmt;
      localStorage.setItem('unworked_gold_gold_price', fmt);
      localStorage.setItem('unworked_gold_gold_price_ts', Date.now().toString());
      changeEl.textContent = '';
      changeEl.className = '';
      const now = new Date();
      if (tsEl) tsEl.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return;
    }
  } catch(e) { /* fall through to backup */ }
  try {
    // Backup: goldprice.org data endpoint
    const res2  = await fetch('https://data-asg.goldprice.org/dbXRates/USD');
    const d2    = await res2.json();
    const price2 = d2?.items?.[0]?.xauPrice;
    if (price2) {
      valEl.textContent = '$' + Number(price2).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (tsEl) tsEl.textContent = 'live';
      return;
    }
  } catch(e2) { /* ignore */ }
  valEl.textContent = '—';
  if (tsEl) tsEl.textContent = '';
}


function showStatus(msg) {
  const pill = document.getElementById('status-pill');
  pill.textContent = msg;
  pill.classList.add('show');
  clearTimeout(pill._t);
  pill._t = setTimeout(() => pill.classList.remove('show'), 2800);
}


// ── SAVE CLAIMS ─────────────────────────────────────────
async function saveClaim(serial, name, type, acres) {
  if (!currentUser) {
    showStatus('Sign in to save claims');
    openAuthPanel();
    return;
  }
  if (!sbClient) { showStatus('Auth not ready'); return; }
  
  try {
    const { error } = await sbClient.from('saved_claims').upsert({
      user_id: currentUser.id,
      serial_number: serial,
      claim_name: name,
      claim_type: type,
      acres: acres,
      saved_at: new Date().toISOString()
    }, { onConflict: 'user_id,serial_number' });

    if (error) throw error;
    showStatus(`⭐ ${name} saved!`);
  } catch(e) {
    console.error(e);
    showStatus('Error saving claim');
  }
}

async function viewSavedClaims() {
  document.getElementById('user-menu').classList.remove('show');
  openAccountPanel();
}


// ── ACCOUNT PANEL ───────────────────────────────────────
function switchAccountTab(el, tab) {
  document.querySelectorAll('.account-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.account-tab-content').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
}

async function openAccountPanel() {
  if (!currentUser) {
    openAuthPanel();
    return;
  }
  document.getElementById('account-panel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
  fetchGoldPrice();
  loadAccountData();
}

async function loadAccountData() {
  if (!sbClient || !currentUser) return;
  loadFindsTab();
  loadSpotsTab();
  loadSavedClaimsTab();
  loadWatchesTab();
}

async function loadFindsTab() {
  try {
    const { data } = await sbClient.from('find_logs').select('*')
      .eq('user_id', currentUser.id).order('created_at', { ascending: false });
    const el = document.getElementById('finds-list');
    if (!data || data.length === 0) {
      el.innerHTML = '<div class="account-empty"><div class="empty-icon">🥇</div>No finds logged yet.</div>';
      return;
    }
    el.innerHTML = data.map(f => `
      <div class="account-item" onclick="flyToCoord(${f.lng}, ${f.lat})">
        <div class="account-item-name">🥇 ${f.find_type}</div>
        <div class="account-item-sub">${f.weight ? f.weight + ' · ' : ''}${f.depth ? f.depth + ' deep · ' : ''}${new Date(f.created_at).toLocaleDateString()}</div>
        ${f.notes ? `<div style="font-size:12px;color:var(--dust);margin-top:4px">${f.notes}</div>` : ''}
      </div>`).join('');
  } catch(e) { console.error(e); }
}

async function loadSpotsTab() {
  try {
    const { data } = await sbClient.from('user_spots').select('*')
      .eq('user_id', currentUser.id).order('created_at', { ascending: false });
    const el = document.getElementById('spots-list');
    if (!data || data.length === 0) {
      el.innerHTML = '<div class="account-empty"><div class="empty-icon">📍</div>No spots saved yet.</div>';
      return;
    }
    const icons = {gold:'🥇',prospect:'⛏️',camp:'⛺',workings:'🕳️',waypoint:'📌',avoid:'⚠️'};
    el.innerHTML = data.map(s => `
      <div class="account-item" onclick="flyToCoord(${s.lng}, ${s.lat})">
        <div class="account-item-name">${icons[s.category]||'📍'} ${s.name}</div>
        <div class="account-item-sub">${s.lat.toFixed(4)}°N ${s.lng.toFixed(4)}°W · ${new Date(s.created_at).toLocaleDateString()}</div>
        ${s.notes ? `<div style="font-size:12px;color:var(--dust);margin-top:4px">${s.notes}</div>` : ''}
      </div>`).join('');
  } catch(e) { console.error(e); }
}

async function loadSavedClaimsTab() {
  try {
    const { data } = await sbClient.from('saved_claims').select('*')
      .eq('user_id', currentUser.id).order('saved_at', { ascending: false });
    const el = document.getElementById('claims-list');
    if (!data || data.length === 0) {
      el.innerHTML = '<div class="account-empty"><div class="empty-icon">⛏️</div>No saved claims yet.</div>';
      return;
    }
    el.innerHTML = data.map(c => `
      <div class="account-item">
        <div class="account-item-name">⛏️ ${c.claim_name || c.serial_number}</div>
        <div class="account-item-sub">${c.serial_number} · ${c.claim_type || ''} · ${c.acres ? parseFloat(c.acres).toFixed(1)+' acres' : ''}</div>
      </div>`).join('');
  } catch(e) { console.error(e); }
}

async function loadWatchesTab() {
  try {
    const { data } = await sbClient.from('claim_watches').select('*')
      .eq('user_id', currentUser.id).order('created_at', { ascending: false });
    const el = document.getElementById('watches-list');
    if (!data || data.length === 0) {
      el.innerHTML = '<div class="account-empty"><div class="empty-icon">🔔</div>No claims watched yet.</div>';
      return;
    }
    el.innerHTML = data.map(w => `
      <div class="account-item">
        <div class="account-item-name">🔔 ${w.claim_name || w.serial_number}</div>
        <div class="account-item-sub">${w.serial_number} · Watching since ${new Date(w.created_at).toLocaleDateString()}</div>
      </div>`).join('');
  } catch(e) { console.error(e); }
}

function flyToCoord(lng, lat) {
  map.flyTo({ center: [lng, lat], zoom: 14, pitch: 55 });
  closeAllPanels();
}

// ── FIND LOGGING ────────────────────────────────────────
async function saveFind() {
  if (!currentUser) {
    showStatus('Sign in to log finds');
    openAuthPanel();
    return;
  }
  if (!sbClient) return;

  const type = document.querySelector('#find-panel select').value;
  const weight = document.querySelector('#find-panel input[placeholder*="weight"], #find-panel input[placeholder*="0.3g"]')?.value || '';
  const depth = document.querySelector('#find-panel input[placeholder*="depth"], #find-panel input[placeholder*="6 inches"]')?.value || '';
  const notes = document.querySelector('#find-panel textarea').value || '';
  const center = map.getCenter();

  try {
    const { error } = await sbClient.from('find_logs').insert({
      user_id: currentUser.id,
      find_type: type,
      weight,
      depth,
      notes,
      lng: center.lng,
      lat: center.lat,
      created_at: new Date().toISOString()
    });

    if (error) throw error;

    // Add a gold star marker at location
    addSpotMarker(center.lng, center.lat, type, 'gold');
    closeAllPanels();
    showStatus(`🥇 ${type} logged!`);
  } catch(e) {
    console.error(e);
    showStatus('Error saving find');
  }
}

// ── CLAIM WATCH ──────────────────────────────────────────
async function watchClaim(serial, name) {
  if (!currentUser) {
    showStatus('Sign in to watch claims');
    openAuthPanel();
    return;
  }
  if (!sbClient) return;

  try {
    const { error } = await sbClient.from('claim_watches').upsert({
      user_id: currentUser.id,
      serial_number: serial,
      claim_name: name,
      notify_email: true
    }, { onConflict: 'user_id,serial_number' });

    if (error) throw error;
    showStatus(`🔔 Watching ${name}`);
  } catch(e) {
    console.error(e);
    showStatus('Error watching claim');
  }
}

// ── SPOT SAVING ─────────────────────────────────────────
let pendingSpotLng = null;
let pendingSpotLat = null;
let selectedSpotCat = 'gold';
let spotMarkers = [];

const SPOT_COLORS = {
  gold: '#F0C040',
  prospect: '#FF9800',
  camp: '#4CAF50',
  workings: '#9C27B0',
  waypoint: '#2196F3',
  avoid: '#F44336'
};

const SPOT_ICONS = {
  gold: '🥇', prospect: '⛏️', camp: '⛺',
  workings: '🕳️', waypoint: '📌', avoid: '⚠️'
};

function selectSpotCat(btn, cat) {
  document.querySelectorAll('.spot-cat-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedSpotCat = cat;
}

function openSpotPanel(lng, lat) {
  if (!currentUser) {
    showStatus('Sign in to save spots');
    openAuthPanel();
    return;
  }
  pendingSpotLng = lng;
  pendingSpotLat = lat;
  document.getElementById('spot-coords').textContent = `${lat.toFixed(5)}°N  ${lng.toFixed(5)}°W`;
  document.getElementById('spot-name').value = '';
  document.getElementById('spot-notes').value = '';
  document.getElementById('spot-panel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}

async function saveSpot() {
  if (!sbClient || !currentUser) return;
  const name = document.getElementById('spot-name').value.trim() || `${SPOT_ICONS[selectedSpotCat]} Spot`;
  const notes = document.getElementById('spot-notes').value.trim();

  // Reverse geocode to get state and county (FCC API — same used for claim popups)
  let state = null; let county = null;
  try {
    const geoRes = await fetch(`https://geo.fcc.gov/api/census/block/find?latitude=${pendingSpotLat}&longitude=${pendingSpotLng}&format=json`);
    if (geoRes.ok) {
      const geoData = await geoRes.json();
      state  = geoData?.State?.name  || null;
      county = geoData?.County?.name || null;
    }
  } catch(e) { /* non-fatal — save without location */ }

  try {
    const { error } = await sbClient.from('user_spots').insert({
      user_id: currentUser.id,
      name,
      notes,
      category: selectedSpotCat,
      lng: pendingSpotLng,
      lat: pendingSpotLat,
      state,
      county,
      created_at: new Date().toISOString()
    });

    if (error) throw error;

    addSpotMarker(pendingSpotLng, pendingSpotLat, name, selectedSpotCat);
    closeAllPanels();
    showStatus(`${SPOT_ICONS[selectedSpotCat]} ${name} saved!`);
  } catch(e) {
    console.error(e);
    showStatus('Error saving spot');
  }
}

function addSpotMarker(lng, lat, name, category) {
  const color = SPOT_COLORS[category] || '#F0C040';
  const icon = SPOT_ICONS[category] || '📍';

  const el = document.createElement('div');
  el.style.cssText = `width:32px;height:32px;background:${color};border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;`;
  const inner = document.createElement('div');
  inner.style.cssText = 'transform:rotate(45deg);font-size:14px;';
  inner.textContent = icon;
  el.appendChild(inner);

  const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom-left' })
    .setLngLat([lng, lat])
    .setPopup(new mapboxgl.Popup({ closeButton: false })
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;background:#1A1810;border:1px solid rgba(201,168,76,0.3);border-radius:10px;padding:12px 16px;color:#E8D9B0;min-width:180px">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#F0C040">${icon} ${name}</div>
          <div style="font-size:11px;color:#6B6248;font-family:'DM Mono',monospace;margin-top:4px">${lat.toFixed(5)}N ${lng.toFixed(5)}W</div>
          <a href="dashboard.html" style="display:inline-block;margin-top:8px;font-size:11px;color:#C9A84C;text-decoration:none">Area intelligence →</a>
        </div>
      `))
    .addTo(map);

  spotMarkers.push(marker);
}

async function loadUserSpots() {
  if (!sbClient || !currentUser || !map) return;
  try {
    const { data, error } = await sbClient
      .from('user_spots')
      .select('*')
      .eq('user_id', currentUser.id);

    if (error) throw error;
    if (data) data.forEach(s => addSpotMarker(s.lng, s.lat, s.name, s.category));
  } catch(e) {
    console.error('Error loading spots:', e);
  }
}

// ── DRAW TO SEARCH ───────────────────────────────────────
let drawMode = false;
let drawStart = null;
let drawBox = null;

function toggleDraw() {
  drawMode = !drawMode;
  const btn = document.getElementById('draw-btn');
  const hint = document.getElementById('draw-hint');
  btn.classList.toggle('active', drawMode);
  hint.style.display = drawMode ? 'block' : 'none';
  map.getCanvas().style.cursor = drawMode ? 'crosshair' : '';
  if (!drawMode && drawBox) {
    if (map.getLayer('draw-box-layer')) map.removeLayer('draw-box-layer');
    if (map.getSource('draw-box-src')) map.removeSource('draw-box-src');
    drawBox = null;
  }
  if (!drawMode) {
    document.getElementById('draw-results').style.display = 'none';
  }
}

function initDrawSearch() {
  let isDrawing = false;

  map.on('mousedown', (e) => {
    if (!drawMode) return;
    isDrawing = true;
    drawStart = e.lngLat;
    map.getCanvas().style.cursor = 'crosshair';
    e.preventDefault();
  });

  map.on('mousemove', (e) => {
    if (!drawMode || !isDrawing || !drawStart) return;
    updateDrawBox(drawStart, e.lngLat);
  });

  map.on('mouseup', (e) => {
    if (!drawMode || !isDrawing || !drawStart) return;
    isDrawing = false;
    updateDrawBox(drawStart, e.lngLat);
    searchClaimsInBox(drawStart, e.lngLat);
    drawStart = null;
  });

  // Touch support for mobile
  map.on('touchstart', (e) => {
    if (!drawMode) return;
    drawStart = e.lngLat;
    e.preventDefault();
  });

  map.on('touchend', (e) => {
    if (!drawMode || !drawStart) return;
    const end = e.lngLat;
    updateDrawBox(drawStart, end);
    searchClaimsInBox(drawStart, end);
    drawStart = null;
  });
}

function updateDrawBox(start, end) {
  const coords = [
    [start.lng, start.lat],
    [end.lng, start.lat],
    [end.lng, end.lat],
    [start.lng, end.lat],
    [start.lng, start.lat]
  ];

  const geojson = {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] }
  };

  if (map.getSource('draw-box-src')) {
    map.getSource('draw-box-src').setData(geojson);
  } else {
    map.addSource('draw-box-src', { type: 'geojson', data: geojson });
    map.addLayer({
      id: 'draw-box-layer',
      type: 'fill',
      source: 'draw-box-src',
      paint: {
        'fill-color': '#F0C040',
        'fill-opacity': 0.1,
        'fill-outline-color': '#F0C040'
      }
    });
  }
}

function searchClaimsInBox(start, end) {
  const minLng = Math.min(start.lng, end.lng);
  const maxLng = Math.max(start.lng, end.lng);
  const minLat = Math.min(start.lat, end.lat);
  const maxLat = Math.max(start.lat, end.lat);

  // Convert bbox to screen pixels for queryRenderedFeatures
  const sw = map.project([minLng, minLat]);
  const ne = map.project([maxLng, maxLat]);

  const features = map.queryRenderedFeatures(
    [sw, ne],
    { layers: ['active-claims-fill', 'closed-claims-fill-1','closed-claims-fill-2','closed-claims-fill-3','closed-claims-fill-4','closed-claims-fill-5'] }
  );

  // Deduplicate by serial number
  const seen = new Set();
  const unique = features.filter(f => {
    const id = f.properties.CSE_NR || f.properties.cse_nr;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const results = document.getElementById('draw-results');

  if (unique.length === 0) {
    results.innerHTML = '<h4>No claims in selection</h4><p style="font-size:12px;color:var(--dust)">Try zooming in or drawing a larger box</p>';
    results.style.display = 'block';
    return;
  }

  let html = `<h4>⛏️ ${unique.length} Claims Found</h4>`;
  unique.slice(0, 20).forEach(f => {
    const p = f.properties;
    const name = p.CSE_NM || p.cse_nm || 'Claim';
    const serial = p.CSE_NR || p.cse_nr || '';
    const type = p.BLM_PROD || p.blm_prod || '';
    const disp = p.CSE_DISP || p.cse_disp || '';
    const color = disp === 'ACTIVE' ? '#4CAF50' : '#F44336';
    html += `<div class="draw-result-item" onclick="flyToClaim(0,0,'${name.replace(/'/g,"\'")}','${serial}')">
      <span>${name}</span>
      <span style="font-family:'DM Mono',monospace;font-size:10px;color:${color}">${disp}</span>
    </div>`;
  });
  if (unique.length > 20) {
    html += `<div style="font-size:11px;color:var(--dust);padding:6px 0">+ ${unique.length - 20} more — zoom in to refine</div>`;
  }
  html += `<div style="margin-top:10px;text-align:right"><span onclick="document.getElementById('draw-results').style.display='none';toggleDraw()" style="font-family:'DM Mono',monospace;font-size:10px;color:var(--dust);cursor:pointer">Close ✕</span></div>`;
  results.innerHTML = html;
  results.style.display = 'block';

  showStatus(`${unique.length} claims in selection`);
}

// ── SUPABASE AUTH ─────────────────────────────────────────
const SUPABASE_URL = 'https://condhfwpzlxrzuadgopc.supabase.co';
let sbClient = null;
let currentUser = null;
let authMode = 'signin';

function initSupabase() {
  const key = localStorage.getItem('unworked_gold_supabase_key') || localStorage.getItem('prospector_supabase_key');
  if (!key) {
    promptSupabaseKey();
    return;
  }
  sbClient = window.supabase.createClient(SUPABASE_URL, key);
  sbClient.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    maybeGateToBetaLanding();
    updateAuthUI();
  });
  sbClient.auth.getSession().then(({ data: { session } }) => {
    currentUser = session?.user || null;
    maybeGateToBetaLanding();
    updateAuthUI();
  });
}

function promptSupabaseKey() {
  // Anon key is safe to be public - use boot key directly
  const key = BOOT_ANON_KEY;
  if (key && key.startsWith('eyJ')) {
    localStorage.setItem('unworked_gold_supabase_key', key);
    initSupabase();
  }
}

function updateAuthUI() {
  const profileLabel = document.querySelector('.nav-item:last-child .nav-label');
  if (currentUser) {
    try {
      localStorage.setItem('unworked_gold_beta_access_granted', 'true');
    } catch (e) {}
    if (profileLabel) profileLabel.textContent = 'Account';
    document.getElementById('user-email').textContent = currentUser.email;
    if (map) loadUserSpots();
  } else {
    if (profileLabel) profileLabel.textContent = 'Sign In';
    if (window.location.pathname.endsWith('/index.html') || window.location.pathname === '/') {
      window.location.replace('beta.html');
    }
  }
}

function openAuthPanel() {
  if (currentUser) {
    // Navigate to dashboard — new tab on desktop, same tab on mobile
    if (window.innerWidth >= 768) {
      window.open('dashboard.html', '_blank');
    } else {
      window.location.href = 'dashboard.html';
    }
    return;
  }
  document.getElementById('auth-panel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}

function toggleAuthMode() {
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  const isSignIn = authMode === 'signin';
  document.getElementById('auth-title').textContent = isSignIn ? 'Sign In' : 'Create Account';
  document.getElementById('auth-sub').textContent = isSignIn ? 'Access your saved claims and finds' : 'Start saving claims and logging finds';
  document.getElementById('auth-submit-btn').textContent = isSignIn ? 'Sign In' : 'Create Account';
  document.getElementById('auth-switch-text').textContent = isSignIn ? "Don't have an account?" : 'Already have an account?';
  document.getElementById('auth-switch-link').textContent = isSignIn ? 'Sign Up' : 'Sign In';
  document.getElementById('auth-error').style.display = 'none';
}

async function submitAuth() {
  if (!sbClient) return;
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.style.display = 'none';

  if (!email || !password) {
    errEl.textContent = 'Please enter your email and password';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('auth-submit-btn');
  btn.textContent = 'Loading...';
  btn.style.opacity = '0.6';

  try {
    let result;
    if (authMode === 'signin') {
      result = await sbClient.auth.signInWithPassword({ email, password });
    } else {
      result = await sbClient.auth.signUp({ email, password });
    }

    if (result.error) {
      errEl.textContent = result.error.message;
      errEl.style.display = 'block';
    } else {
      closeAllPanels();
      showStatus(authMode === 'signup' ? 'Account created! Check email to verify.' : 'Welcome back!');
    }
  } catch (e) {
    errEl.textContent = 'Something went wrong. Try again.';
    errEl.style.display = 'block';
  }

  btn.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
  btn.style.opacity = '1';
}

async function signInWithGoogle() {
  if (!sbClient) return;
  const redirectTo = window.location.origin;
  await sbClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo }
  });
}

async function signOut() {
  if (!sbClient) return;
  await sbClient.auth.signOut();
  document.getElementById('user-menu').classList.remove('show');
  showStatus('Signed out');
}



function viewFinds() {
  document.getElementById('user-menu').classList.remove('show');
  openAccountPanel();
}

// Close user menu on outside click
document.addEventListener('click', (e) => {
  const menu = document.getElementById('user-menu');
  if (!menu.contains(e.target) && !e.target.closest('.nav-item:last-child')) {
    menu.classList.remove('show');
  }
});

// ── SEARCH ──────────────────────────────────────────────
let searchTimeout = null;

document.getElementById('search-input').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(searchTimeout);
  if (q.length < 2) {
    hideSearchResults();
    return;
  }
  searchTimeout = setTimeout(() => runSearch(q), 300);
});

document.getElementById('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideSearchResults();
  } else if (e.key === 'Enter') {
    // Click first result if available
    const first = document.querySelector('#search-results .search-result-item');
    if (first) first.click();
    else {
      // If no results yet, trigger search immediately
      const q = document.getElementById('search-input').value.trim();
      if (q.length >= 2) runSearch(q);
    }
  }
});

document.addEventListener('click', (e) => {
  if (!document.getElementById('searchbar').contains(e.target)) {
    hideSearchResults();
  }
});

// ── COORDINATE SEARCH ───────────────────────────────────
function parseCoordinates(q) {
  // Normalise: strip degree symbols, N/S/E/W letters, commas → spaces
  const raw = q.replace(/[°\u00b0]/g, ' ').replace(/,/g, ' ').trim();

  // Try to pull two numeric tokens
  // Handles: "45.123 -118.456"  "45.123 118.456 W"  "45.123N 118.456W"
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return null;

  // Extract numeric values
  let lat = parseFloat(tokens[0].replace(/[NSns]/g, ''));
  let lng = parseFloat(tokens[tokens.length === 4 ? 2 : 1].replace(/[EWew]/g, ''));

  if (isNaN(lat) || isNaN(lng)) return null;

  // Apply hemisphere from letters
  const upper = q.toUpperCase();
  if (upper.includes('S') && lat > 0) lat = -lat;
  if (upper.includes('W') && lng > 0) lng = -lng;

  // Sanity check — must be plausible earth coords
  if (lat < -90 || lat > 90)   return null;
  if (lng < -180 || lng > 180) return null;

  // Reject if both numbers look like they could be a search query (e.g. "10 20" is too ambiguous)
  // Require at least one decimal point or an explicit direction indicator
  const hasDec = q.includes('.');
  const hasDir = /[NSEWnsew°]/.test(q);
  if (!hasDec && !hasDir) return null;

  return { lat, lng };
}

async function runSearch(q) {
  if (!map) return;

  // Detect coordinate input before doing a normal search
  const coord = parseCoordinates(q);
  if (coord) {
    map.flyTo({ center: [coord.lng, coord.lat], zoom: 14, pitch: 0 });
    document.getElementById('search-input').blur();
    hideSearchResults();
    showStatus(`${coord.lat.toFixed(5)}\u00b0N  ${Math.abs(coord.lng).toFixed(5)}\u00b0W`);
    return;
  }

  const results = document.getElementById('search-results');
  results.innerHTML = '<div class="search-section-label">Searching...</div>';
  results.classList.add('show');

  const [placeResults, claimResults] = await Promise.all([
    searchPlaces(q),
    searchClaims(q)
  ]);

  renderSearchResults(placeResults, claimResults, q);
}

async function searchPlaces(q) {
  try {
    const token = mapboxgl.accessToken;
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=us&bbox=-124.7,42.0,-116.5,46.3&limit=4&access_token=${token}`
    );
    const data = await res.json();
    return data.features || [];
  } catch { return []; }
}

async function searchClaims(q) {
  // Search claim names from active tileset via Mapbox query
  // We'll do a simple client-side approach using rendered features
  if (!map) return [];
  try {
    const features = map.queryRenderedFeatures({ layers: ['active-claims-fill'] });
    const matches = features.filter(f => {
      const name = f.properties.CSE_NM || f.properties.cse_nm || '';
      return name.toLowerCase().includes(q.toLowerCase());
    }).slice(0, 5);
    return matches;
  } catch { return []; }
}

function renderSearchResults(places, claims, q) {
  const results = document.getElementById('search-results');
  let html = '';

  if (claims.length > 0) {
    html += `<div class="search-section-label">Mining Claims</div>`;
    claims.forEach(f => {
      const name = f.properties.CSE_NM || f.properties.cse_nm || 'Claim';
      const serial = f.properties.CSE_NR || f.properties.cse_nr || '';
      const type = f.properties.BLM_PROD || f.properties.blm_prod || '';
      const coords = f.geometry.type === 'Polygon'
        ? f.geometry.coordinates[0][0]
        : f.geometry.coordinates[0][0][0];
      html += `
        <div class="search-result-item" onclick="flyToClaim(${coords[0]}, ${coords[1]}, '${name.replace(/'/g,"\'")}', '${serial}')">
          <div class="result-icon">⛏️</div>
          <div class="result-text">
            <div class="result-name">${name}</div>
            <div class="result-sub">${serial} · ${type}</div>
          </div>
          <div class="result-tag active">ACTIVE</div>
        </div>`;
    });
  }

  if (places.length > 0) {
    html += `<div class="search-section-label">Places</div>`;
    places.forEach(p => {
      const [lng, lat] = p.center;
      html += `
        <div class="search-result-item" onclick="flyToPlace(${lng}, ${lat}, '${p.place_name.replace(/'/g,"\'")}')">
          <div class="result-icon">📍</div>
          <div class="result-text">
            <div class="result-name">${p.text}</div>
            <div class="result-sub">${p.place_name}</div>
          </div>
          <div class="result-tag place">PLACE</div>
        </div>`;
    });
  }

  if (!html) {
    html = '<div class="search-result-item"><div class="result-text"><div class="result-name" style="color:var(--dust)">No results found</div></div></div>';
  }

  results.innerHTML = html;
  results.classList.add('show');
}

function flyToClaim(lng, lat, name, serial) {
  map.flyTo({ center: [lng, lat], zoom: 14, pitch: 55 });
  showStatus(`${name} · ${serial}`);
  hideSearchResults();
  document.getElementById('search-input').value = name;
}

function flyToPlace(lng, lat, name) {
  map.flyTo({ center: [lng, lat], zoom: 12, pitch: 45 });
  showStatus(name);
  hideSearchResults();
  document.getElementById('search-input').value = name.split(',')[0];
}

function hideSearchResults() {
  document.getElementById('search-results').classList.remove('show');
}

// ── AI FIELD TOOLS ───────────────────────────────────────

function toggleAIMenu() {
  // Close other menus first
  if (layerPanelOpen) toggleLayers();
  if (styleSwitcherOpen) toggleStyles();
  aiMenuOpen = !aiMenuOpen;
  document.getElementById('ai-tools-menu').classList.toggle('open', aiMenuOpen);
  document.getElementById('ai-btn').classList.toggle('active', aiMenuOpen);
}

function closeAIMenu() {
  aiMenuOpen = false;
  document.getElementById('ai-tools-menu').classList.remove('open');
  document.getElementById('ai-btn').classList.remove('active');
}

function checkProStatus() {
  // TEMP: Pro unlocked for testing — flip to false before launch
  // TODO: Wire to Supabase subscription table for v0.5.0 launch.
  // Query: supabase.from('subscriptions').select('status').eq('user_id', currentUser.id).single()
  // Return true only if data.status === 'active' || data.status === 'trialing'
  return true;
}

function getRockIdUses() {
  return parseInt(localStorage.getItem('rockid_lifetime_uses') || '0', 10);
}

function incrementRockIdUses() {
  const n = getRockIdUses() + 1;
  localStorage.setItem('rockid_lifetime_uses', String(n));
  return n;
}

function openRockIdentifier() {
  closeAIMenu();
  const uses = getRockIdUses();
  const isPro = checkProStatus();
  const remaining = Math.max(0, FREE_ROCK_ID_LIMIT - uses);

  // Update usage display
  const usageBar = document.getElementById('rockid-usage-bar');
  const usageCount = document.getElementById('rockid-usage-count');
  usageBar.style.display = isPro ? 'none' : 'flex';
  usageCount.textContent = isPro ? 'Unlimited' : (remaining + ' / ' + FREE_ROCK_ID_LIMIT);

  // Show pro gate or upload zone
  if (!isPro && uses >= FREE_ROCK_ID_LIMIT) {
    document.getElementById('rockid-upload-zone').style.display = 'none';
    document.getElementById('rockid-pro-gate').style.display = 'block';
  } else {
    document.getElementById('rockid-upload-zone').style.display = 'block';
    document.getElementById('rockid-pro-gate').style.display = 'none';
  }

  // Reset any previous state
  document.getElementById('rockid-preview').style.display = 'none';
  document.getElementById('rockid-loading').style.display = 'none';
  document.getElementById('rockid-result').style.display = 'none';
  document.getElementById('rockid-error').style.display = 'none';

  document.getElementById('rock-id-panel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}

function closeRockIdentifier() {
  document.getElementById('rock-id-panel').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

function resetRockId() {
  document.getElementById('rockid-preview').style.display = 'none';
  document.getElementById('rockid-result').style.display = 'none';
  document.getElementById('rockid-loading').style.display = 'none';
  document.getElementById('rockid-error').style.display = 'none';
  // Reset file input
  const input = document.querySelector('#rock-id-panel input[type=file]');
  if (input) input.value = '';
  // Re-evaluate gate
  const uses = getRockIdUses();
  const isPro = checkProStatus();
  const remaining = Math.max(0, FREE_ROCK_ID_LIMIT - uses);
  document.getElementById('rockid-usage-count').textContent = isPro ? 'Unlimited' : (remaining + ' / ' + FREE_ROCK_ID_LIMIT);
  if (!isPro && uses >= FREE_ROCK_ID_LIMIT) {
    document.getElementById('rockid-upload-zone').style.display = 'none';
    document.getElementById('rockid-pro-gate').style.display = 'block';
  } else {
    document.getElementById('rockid-upload-zone').style.display = 'block';
    document.getElementById('rockid-pro-gate').style.display = 'none';
  }
}

function openOutcropMapper() {
  closeAIMenu();
  // Reset state
  document.getElementById('outcrop-preview').style.display = 'none';
  document.getElementById('outcrop-loading').style.display = 'none';
  document.getElementById('outcrop-result').style.display = 'none';
  document.getElementById('outcrop-error').style.display = 'none';
  document.getElementById('outcrop-desc').style.display = 'block';
  document.getElementById('outcrop-upload-zone').style.display = 'block';
  document.getElementById('outcrop-pro-gate').style.display = 'none';
  const input = document.querySelector('#outcrop-panel input[type=file]');
  if (input) input.value = '';
  document.getElementById('outcrop-panel').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}

function closeOutcropMapper() {
  document.getElementById('outcrop-panel').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

function resetOutcrop() {
  document.getElementById('outcrop-preview').style.display = 'none';
  document.getElementById('outcrop-result').style.display = 'none';
  document.getElementById('outcrop-loading').style.display = 'none';
  document.getElementById('outcrop-error').style.display = 'none';
  document.getElementById('outcrop-desc').style.display = 'block';
  document.getElementById('outcrop-upload-zone').style.display = 'block';
  const input = document.querySelector('#outcrop-panel input[type=file]');
  if (input) input.value = '';
}

// Compress image to max 1024px, JPEG quality 0.82, return base64
async function compressImage(file, maxDim, quality) {
  maxDim = maxDim || 1024;
  quality = quality || 0.82;
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(ev) {
      var img = new Image();
      img.onload = function() {
        var w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Call Anthropic vision API — returns parsed JSON object
async function analyzeWithClaude(base64, systemPrompt, userPrompt) {
  // Calls via Cloudflare Pages Function proxy (/api/claude) to avoid CORS
  // API key is stored as ANTHROPIC_KEY env var in Cloudflare Pages settings
  var response = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text', text: userPrompt }
        ]
      }]
    })
  });
  if (!response.ok) {
    var err = {};
    try { err = await response.json(); } catch(e) {}
    throw new Error(err.error ? err.error.message : ('API error ' + response.status));
  }
  var data = await response.json();
  var text = (data.content && data.content[0] && data.content[0].text) ? data.content[0].text : '';
  // Strip any markdown code fences if present
  var clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(clean);
}

function getLocationContext() {
  if (!map) return '';
  var center = map.getCenter();
  return center.lat.toFixed(4) + ' N ' + Math.abs(center.lng).toFixed(4) + ' W';
}

async function handleRockIdUpload(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var isPro = checkProStatus();
  var uses = getRockIdUses();
  if (!isPro && uses >= FREE_ROCK_ID_LIMIT) {
    document.getElementById('rockid-upload-zone').style.display = 'none';
    document.getElementById('rockid-pro-gate').style.display = 'block';
    return;
  }

  // Show preview immediately
  var objectUrl = URL.createObjectURL(file);
  document.getElementById('rockid-preview-img').src = objectUrl;
  document.getElementById('rockid-preview').style.display = 'block';
  document.getElementById('rockid-upload-zone').style.display = 'none';
  document.getElementById('rockid-result').style.display = 'none';
  document.getElementById('rockid-error').style.display = 'none';
  document.getElementById('rockid-loading').style.display = 'block';

  var locationCtx = getLocationContext();

  var systemPrompt = 'You are a field mineralogist helping a gold prospector identify rocks and minerals from a close-up photo taken 1-3 feet away.\n\nRespond ONLY with valid JSON in this exact format, no other text:\n{"what":"2-3 sentences describing the rock or mineral in plain English. Include color, texture, and visible features.","gold_significance":"1-2 sentences on whether this is a gold indicator and why. Use phrases like may indicate or worth investigating.","next":"1-2 sentences with a specific prospecting action to take at this location."}\n\nRules: Use 10th grade reading level. Be direct and practical. If the photo is unclear, say so in what. Never use asterisks or markdown formatting inside the JSON values.';

  var userPrompt = 'Identify this rock or mineral sample.' + (locationCtx ? ' Location context: ' + locationCtx + '.' : '') + ' Analyze for gold prospecting significance.';

  try {
    var base64 = await compressImage(file);
    var result = await analyzeWithClaude(base64, systemPrompt, userPrompt);

    // Consume a use
    var newCount = incrementRockIdUses();
    var remaining = Math.max(0, FREE_ROCK_ID_LIMIT - newCount);
    document.getElementById('rockid-usage-count').textContent = isPro ? 'Unlimited' : (remaining + ' / ' + FREE_ROCK_ID_LIMIT);

    // Render result
    document.getElementById('rockid-what').textContent = result.what || '';
    document.getElementById('rockid-gold').textContent = result.gold_significance || '';
    document.getElementById('rockid-next').textContent = result.next || '';
    var locNote = document.getElementById('rockid-location');
    if (locationCtx) {
      locNote.textContent = 'Location context: ' + locationCtx;
      locNote.style.display = 'block';
    }

    document.getElementById('rockid-loading').style.display = 'none';
    document.getElementById('rockid-result').style.display = 'block';

  } catch(e) {
    console.error('Rock ID error:', e);
    document.getElementById('rockid-loading').style.display = 'none';
    var errEl = document.getElementById('rockid-error');
    if (e.message && e.message.includes('not configured')) {
      errEl.textContent = 'AI analysis is not available yet. The API key needs to be configured in the app settings.';
    } else if (e.message && e.message.includes('JSON')) {
      errEl.textContent = 'Got an unexpected response format — please try again with a clearer, well-lit photo.';
    } else {
      errEl.textContent = 'Analysis failed. Check your connection and try again with a clearer photo.';
    }
    errEl.style.display = 'block';
  }
}

async function handleOutcropUpload(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];

  // Show preview immediately
  var objectUrl = URL.createObjectURL(file);
  document.getElementById('outcrop-preview-img').src = objectUrl;
  document.getElementById('outcrop-preview').style.display = 'block';
  document.getElementById('outcrop-upload-zone').style.display = 'none';
  document.getElementById('outcrop-desc').style.display = 'none';
  document.getElementById('outcrop-result').style.display = 'none';
  document.getElementById('outcrop-error').style.display = 'none';
  document.getElementById('outcrop-loading').style.display = 'block';

  var locationCtx = getLocationContext();

  var systemPrompt = 'You are a field geologist helping a gold prospector read a rock outcrop or cliff face from a photo taken at 20-300 feet away.\n\nRespond ONLY with valid JSON in this exact format, no other text:\n{"what_you_see":"2-3 sentences describing visible rock types, layering, veins, color changes, or structural features.","what_it_means":"2-3 sentences interpreting the geology in plain English. Is it folded, faulted, or hydrothermally altered? What type of environment is this?","where_to_look":"2-3 sentences with specific prospecting direction. Follow which feature? Look at which contact or zone?"}\n\nRules: Use 10th grade reading level. Explain geological terms in plain language. Frame as a field guide. If no outcrop is visible or the photo is unclear, say so in what_you_see. Never promise gold exists. Never use asterisks or markdown formatting inside the JSON values.';

  var userPrompt = 'Read this rock outcrop for gold prospecting significance.' + (locationCtx ? ' Location context: ' + locationCtx + '.' : '') + ' What are the key structural and mineralogical features and where should I focus my prospecting?';

  try {
    var base64 = await compressImage(file);
    var result = await analyzeWithClaude(base64, systemPrompt, userPrompt);

    // Render result
    document.getElementById('outcrop-what').textContent = result.what_you_see || '';
    document.getElementById('outcrop-means').textContent = result.what_it_means || '';
    document.getElementById('outcrop-where').textContent = result.where_to_look || '';
    var locNote = document.getElementById('outcrop-location');
    if (locationCtx) {
      locNote.textContent = 'Location context: ' + locationCtx;
      locNote.style.display = 'block';
    }

    document.getElementById('outcrop-loading').style.display = 'none';
    document.getElementById('outcrop-result').style.display = 'block';

  } catch(e) {
    console.error('Outcrop error:', e);
    document.getElementById('outcrop-loading').style.display = 'none';
    var errEl = document.getElementById('outcrop-error');
    if (e.message && e.message.includes('not configured')) {
      errEl.textContent = 'AI analysis is not available yet. The API key needs to be configured in the app settings.';
    } else if (e.message && e.message.includes('JSON')) {
      errEl.textContent = 'Got an unexpected response format — please try again with a clearer photo of the rock face.';
    } else {
      errEl.textContent = 'Analysis failed. Check your connection and try again with a better photo.';
    }
    errEl.style.display = 'block';
  }
}

// Close AI menu on outside click
document.addEventListener('click', function(e) {
  if (aiMenuOpen && !e.target.closest('#ai-tools-menu') && !e.target.closest('#ai-btn')) {
    closeAIMenu();
  }
});

// ── BOOT: fetch config from Supabase then init map ──
const BOOT_SUPABASE_URL = window.UNWORKED_GOLD_CONFIG?.supabase_url || window.PROSPECTOR_CONFIG?.supabase_url || 'https://condhfwpzlxrzuadgopc.supabase.co';
const BOOT_ANON_KEY = window.UNWORKED_GOLD_CONFIG?.supabase_anon_key || window.PROSPECTOR_CONFIG?.supabase_anon_key || '';

window.addEventListener('load', async () => {
  try {
    const res = await fetch(
      `${BOOT_SUPABASE_URL}/rest/v1/app_config?select=key,value`,
      {
        headers: {
          'apikey': BOOT_ANON_KEY,
          'Authorization': `Bearer ${BOOT_ANON_KEY}`
        }
      }
    );
    const rows = await res.json();
    const config = {};
    rows.forEach(r => config[r.key] = r.value);

    // Store in localStorage as cache
    if (config.mapbox_token) {
      localStorage.setItem('unworked_gold_mapbox_token', config.mapbox_token);
    }
    if (config.supabase_anon_key) {
      localStorage.setItem('unworked_gold_supabase_key', config.supabase_anon_key);
    }
    if (config.anthropic_key) {
      anthropicKey = config.anthropic_key;
    }

    // Init map with token from config
    const token = config.mapbox_token || localStorage.getItem('unworked_gold_mapbox_token') || localStorage.getItem('prospector_mapbox_token');
    if (token && token.startsWith('pk.')) {
      document.getElementById('token-input').value = token;
      initMap();
    }
  } catch(e) {
    console.error('Config fetch failed, falling back to localStorage', e);
    const saved = localStorage.getItem('unworked_gold_mapbox_token') || localStorage.getItem('prospector_mapbox_token');
    if (saved && saved.startsWith('pk.')) {
      document.getElementById('token-input').value = saved;
      initMap();
    }
  }
});
