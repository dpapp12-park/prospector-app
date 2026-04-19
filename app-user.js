// ==========================================================
// app-user.js — Unworked Gold user content module
// Split from app.js, Session 8 commit 3 (April 19, 2026)
//
// CONTENTS:
//   saveClaim / viewSavedClaims
//   Account panel: switchAccountTab, openAccountPanel,
//     loadAccountData, loadFindsTab, loadSpotsTab,
//     loadSavedClaimsTab, loadWatchesTab
//   Finds: saveFind, viewFinds, flyToCoord
//   Watches: watchClaim
//   Spots: selectSpotCat, openSpotPanel, saveSpot,
//     addSpotMarker, loadUserSpots
//   User menu outside-click listener
//
// USES: sbClient, currentUser from app-auth.js (runtime).
// USES: map, showStatus, openAuthPanel from app.js/app-auth.js.
//
// LOAD ORDER: after app-auth.js (needs sbClient, currentUser).
// ==========================================================

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
