// ==========================================================
// app-search.js — Unworked Gold search module
// Split from app.js, Session 8 commit 3 (April 19, 2026)
//
// CONTENTS:
//   Draw-box search: toggleDraw, initDrawSearch, updateDrawBox,
//     searchClaimsInBox
//   State: searchTimeout
//   Search input event listeners (input, keydown, outside-click)
//   Coordinate search: parseCoordinates
//   Unified search: runSearch, searchPlaces, searchClaims,
//     renderSearchResults, flyToClaim, flyToPlace, hideSearchResults
//
// LOAD ORDER: after app.js (uses map, showStatus).
// Event listeners attach at parse time to DOM elements from
// index.html — safe because all scripts load at end of body.
// ==========================================================

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



// ── SEARCH ──────────────────────────────────────────────
// Enter-only submit per Session 37 spec section 2.1: "Submits on Enter,
// not on paste, not on every keystroke." The previous debounced input
// listener (autocomplete-style geocoding on every keystroke) was
// removed in Step 2 of the desktop UI rebuild.

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

