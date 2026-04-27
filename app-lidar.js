// ==========================================================
// app-lidar.js — Unworked Gold LiDAR hillshade module
// Split from app.js, Session 8 commit 2 (April 19, 2026)
//
// CONTENTS:
//   STATE:     LIDAR_STYLES (10 styles), activeLidarStyles,
//              focusedLidarId, lidarLayerOpacity,
//              customHillshadeParams, lidarCustomDebounceTimer,
//              customHillshadeActive
//   BUILDERS:  buildLidarSourceUrl, buildCustomHillshadeUrl
//   LIFECYCLE: registerLidarLayers, registerCustomHillshadeLayer
//   TOGGLES:   toggleLidarStyle, toggleCustomHillshade,
//              setFocusedLidarLayer
//   CONTROLS:  updateLidarOpacity, updateCustomParam,
//              resetCustomHillshade
//   UTIL:      syncLidarWaterMask, updateLidarActiveCount
//
// All requests go through hillshade-proxy.dpapp12.workers.dev →
// elevation.nationalmap.gov exportImage, 24h Cloudflare edge cache.
//
// LOAD ORDER: after app.js (uses map).
// registerLidarLayers + registerCustomHillshadeLayer are called
// from addDemoLayers in app-layers.js.
// ==========================================================

// ── LIDAR HILLSHADE STATE ──────────────────────────────
// 11 USGS 3DEP styles + Custom Hillshade Generator.
// All render via hillshade-proxy.dpapp12.workers.dev →
// elevation.nationalmap.gov/.../exportImage, 24h edge cache.
const LIDAR_STYLES = [
  { id: 'hillshade-gray',    label: 'Standard Gray Hillshade',    type: 'named', rasterFunction: 'Hillshade Gray' },
  { id: 'hillshade-multi',   label: 'Hillshade Multidirectional', type: 'named', rasterFunction: 'Hillshade Multidirectional',
    paint: { 'raster-opacity': 1.0, 'raster-contrast': 0.35, 'raster-brightness-max': 0.92 } },
  { id: 'hillshade-tinted',  label: 'Hillshade Elevation Tinted', type: 'named', rasterFunction: 'Hillshade Elevation Tinted' },
  { id: 'hillshade-stretch', label: 'Hillshade Gray-Stretch',     type: 'named', rasterFunction: 'Hillshade Gray-Stretch' },
  { id: 'low-angle',         label: 'Low Angle Hillshade',        type: 'param', azimuth: 315, altitude: 15, zfactor: 2 },
  { id: 'east-lit',          label: 'East-Lit Hillshade',         type: 'param', azimuth: 90,  altitude: 45, zfactor: 2 },
  { id: 'south-lit',         label: 'South-Lit Hillshade',        type: 'param', azimuth: 180, altitude: 45, zfactor: 2 },
  { id: 'slope-map',         label: 'Slope Map',                  type: 'named', rasterFunction: 'Slope Map' },
  { id: 'aspect-map',        label: 'Aspect Map',                 type: 'named', rasterFunction: 'Aspect Map' },
  { id: 'contour',           label: 'Contour Smoothed 25',        type: 'named', rasterFunction: 'Contour Smoothed 25', allowRetry: true }
];
// Boot with no LiDAR style active — basemap is fully visible on first load.
// User clicks a row in the LiDAR panel to turn one on. focusedLidarId stays
// pointed at hillshade-gray so the opacity slider has a sensible default
// when the panel opens; it becomes meaningful only after a style is active.
let activeLidarStyles = new Set();
let focusedLidarId = 'hillshade-gray';
let lidarLayerOpacity = {};
LIDAR_STYLES.forEach(s => { lidarLayerOpacity[s.id] = 100; });
let customHillshadeParams = { azimuth: 315, altitude: 45, zfactor: 2 };
let lidarCustomDebounceTimer = null;


// ── LIDAR HILLSHADE — URL BUILDERS ──────────────────────
// buildLidarSourceUrl: named styles use {"rasterFunction":"NAME"}.
// Parameterized styles (low-angle/east-lit/south-lit) use the
// "Hillshade" rasterFunction with rasterFunctionArguments for
// Azimuth/Altitude/ZFactor. Custom delegates to buildCustomHillshadeUrl.
function buildLidarSourceUrl(styleId) {
  const style = LIDAR_STYLES.find(s => s.id === styleId);
  if (!style) return null;
  let rule;
  if (style.type === 'named') {
    rule = { rasterFunction: style.rasterFunction };
  } else if (style.type === 'param') {
    rule = {
      rasterFunction: 'Hillshade',
      rasterFunctionArguments: {
        Azimuth:  style.azimuth,
        Altitude: style.altitude,
        ZFactor:  style.zfactor
      }
    };
  } else if (style.type === 'custom') {
    return buildCustomHillshadeUrl();
  }
  const encoded = encodeURIComponent(JSON.stringify(rule));
  return `https://hillshade-proxy.dpapp12.workers.dev/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&renderingRule=${encoded}&f=image`;
}

function buildCustomHillshadeUrl() {
  const rule = {
    rasterFunction: 'Hillshade',
    rasterFunctionArguments: {
      Azimuth:  Number(customHillshadeParams.azimuth),
      Altitude: Number(customHillshadeParams.altitude),
      ZFactor:  Number(customHillshadeParams.zfactor)
    }
  };
  const encoded = encodeURIComponent(JSON.stringify(rule));
  return `https://hillshade-proxy.dpapp12.workers.dev/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&renderingRule=${encoded}&f=image`;
}

// ── LIDAR HILLSHADE — MAP REGISTRATION ──────────────────
// Called from addDemoLayers (initial load + setStyle re-init).
// Adds 11 raster source/layer pairs, all inserted below
// 'active-claims-fill' so claim polygons remain readable.
// Visibility per-layer reflects activeLidarStyles Set.
// Opacity reflects lidarLayerOpacity map (user-adjustable).
// Per-style paint tuning (e.g. contrast boost for Multidirectional)
// comes from the style.paint field in LIDAR_STYLES.
function registerLidarLayers() {
  if (!map) return;
  LIDAR_STYLES.forEach(style => {
    const srcId = `lidar-src-${style.id}`;
    const lyrId = `lidar-layer-${style.id}`;
    const url = buildLidarSourceUrl(style.id);
    if (!url) return;

    if (!map.getSource(srcId)) {
      map.addSource(srcId, {
        type: 'raster',
        tiles: [url],
        tileSize: 256,
        attribution: 'USGS The National Map: 3D Elevation Program'
      });
    }
    if (!map.getLayer(lyrId)) {
      // Start from per-style paint (if any) else default, then overlay
      // the user's stored opacity for this style.
      const paint = Object.assign({ 'raster-opacity': 1.0 }, style.paint || {});
      const storedPct = lidarLayerOpacity[style.id];
      if (typeof storedPct === 'number') {
        paint['raster-opacity'] = storedPct / 100;
      }
      map.addLayer({
        id: lyrId,
        type: 'raster',
        source: srcId,
        layout: { visibility: activeLidarStyles.has(style.id) ? 'visible' : 'none' },
        paint: paint
      }, 'active-claims-fill');
    }
  });
  // On first mount, mirror state to DOM (handles setStyle re-init too).
  setFocusedLidarLayer(focusedLidarId);
  updateLidarActiveCount();
}

// ── LIDAR HILLSHADE — TOGGLE + FOCUS ────────────────────
// Click behavior:
//   inactive row                → turn ON + focus
//   active but not focused      → set focus (don't toggle off)
//   active AND focused          → toggle OFF (unless last one on)
function toggleLidarStyle(styleId) {
  const style = LIDAR_STYLES.find(s => s.id === styleId);
  if (!style) return;

  const isActive  = activeLidarStyles.has(styleId);
  const isFocused = (focusedLidarId === styleId);

  if (!isActive) {
    activeLidarStyles.add(styleId);
    focusedLidarId = styleId;
  } else if (!isFocused) {
    focusedLidarId = styleId;
  } else {
    // Click on the focused-and-active row turns it off. Zero-active is
    // allowed (matches the new boot-zero default from Finding #1a). If
    // any styles remain active, focus the first one; if none remain,
    // focusedLidarId stays pointed at the just-deactivated style so the
    // LAYER CONTROLS readout stays meaningful when the user re-enables.
    // See Finding #11a (Session 24).
    activeLidarStyles.delete(styleId);
    if (activeLidarStyles.size > 0) {
      focusedLidarId = Array.from(activeLidarStyles)[0];
    }
  }

  // Mirror active state to bullets + name classes on every row
  LIDAR_STYLES.forEach(s => {
    const bullet = document.getElementById(`lidar-bullet-${s.id}`);
    const name   = document.getElementById(`lidar-name-${s.id}`);
    const on     = activeLidarStyles.has(s.id);
    if (bullet) bullet.classList.toggle('on', on);
    if (name)   name.classList.toggle('on', on);
  });

  // Mirror active state to map layer visibility
  if (map) {
    LIDAR_STYLES.forEach(s => {
      const lyrId = `lidar-layer-${s.id}`;
      if (map.getLayer(lyrId)) {
        map.setLayoutProperty(lyrId, 'visibility',
          activeLidarStyles.has(s.id) ? 'visible' : 'none');
      }
    });
  }

  setFocusedLidarLayer(focusedLidarId);
  syncLidarWaterMask();
  updateLidarActiveCount();
  updateActiveLayerBar();
}

// ── LIDAR HILLSHADE — FOCUSED LAYER UI SYNC ─────────────
// Updates: focused row border, Layer Controls panel name,
// Custom params visibility, opacity slider to stored value.
function setFocusedLidarLayer(styleId) {
  const style = LIDAR_STYLES.find(s => s.id === styleId);
  if (!style) return;
  focusedLidarId = styleId;

  LIDAR_STYLES.forEach(s => {
    const row = document.getElementById(`lidar-row-${s.id}`);
    if (row) row.classList.toggle('focused', s.id === styleId);
  });

  const nameEl = document.getElementById('lidar-focused-name');
  if (nameEl) nameEl.textContent = style.label;

  // Reflect stored opacity for newly focused layer
  const slider = document.getElementById('lidar-opacity-slider');
  const val    = document.getElementById('lidar-opacity-value');
  const pct    = (typeof lidarLayerOpacity[styleId] === 'number') ? lidarLayerOpacity[styleId] : 100;
  if (slider) slider.value = pct;
  if (val)    val.textContent = `${pct}%`;
}

// ── LIDAR HILLSHADE — OPACITY (focused layer only) ──────
function updateLidarOpacity(value) {
  const pct = Number(value);
  lidarLayerOpacity[focusedLidarId] = pct;
  const val = document.getElementById('lidar-opacity-value');
  if (val) val.textContent = `${pct}%`;
  if (map) {
    const lyrId = `lidar-layer-${focusedLidarId}`;
    if (map.getLayer(lyrId)) {
      map.setPaintProperty(lyrId, 'raster-opacity', pct / 100);
    }
  }
}

// ── LIDAR HILLSHADE — CUSTOM GENERATOR ──────────────────
// Debounced 300ms so dragging sliders doesn't hammer USGS.
// Uses source.setTiles() (Mapbox GL v2+) to swap URL in place.
function updateCustomParam(which, value) {
  const num = Number(value);
  customHillshadeParams[which] = num;

  if (which === 'azimuth') {
    const el = document.getElementById('lidar-azimuth-value');
    if (el) el.innerHTML = `${num}&deg;`;
  } else if (which === 'altitude') {
    const el = document.getElementById('lidar-altitude-value');
    if (el) el.innerHTML = `${num}&deg;`;
  } else if (which === 'zfactor') {
    const el = document.getElementById('lidar-zfactor-value');
    if (el) el.innerHTML = `${num}&times;`;
  }

  clearTimeout(lidarCustomDebounceTimer);
  lidarCustomDebounceTimer = setTimeout(() => {
    if (!map) return;
    const src = map.getSource('custom-hs-src');
    if (src && typeof src.setTiles === 'function') {
      src.setTiles([buildCustomHillshadeUrl()]);
    }
  }, 300);
}

function resetCustomHillshade() {
  customHillshadeParams = { azimuth: 315, altitude: 45, zfactor: 2 };
  const az = document.getElementById('lidar-azimuth-slider');
  const al = document.getElementById('lidar-altitude-slider');
  const zf = document.getElementById('lidar-zfactor-slider');
  if (az) az.value = 315;
  if (al) al.value = 45;
  if (zf) zf.value = 2;
  const azV = document.getElementById('lidar-azimuth-value');
  const alV = document.getElementById('lidar-altitude-value');
  const zfV = document.getElementById('lidar-zfactor-value');
  if (azV) azV.innerHTML = '315&deg;';
  if (alV) alV.innerHTML = '45&deg;';
  if (zfV) zfV.innerHTML = '2&times;';
  if (map) {
    const src = map.getSource('custom-hs-src');
    if (src && typeof src.setTiles === 'function') {
      src.setTiles([buildCustomHillshadeUrl()]);
    }
  }
}

// ── CUSTOM HILLSHADE — STANDALONE REGISTRATION + TOGGLE ──
// Runs alongside registerLidarLayers but fully independent.
// Source/layer created once; visibility toggled via switch.
let customHillshadeActive = false;

function registerCustomHillshadeLayer() {
  if (!map) return;
  if (!map.getSource('custom-hs-src')) {
    map.addSource('custom-hs-src', {
      type: 'raster',
      tiles: [buildCustomHillshadeUrl()],
      tileSize: 256,
      attribution: 'USGS The National Map: 3D Elevation Program'
    });
  }
  if (!map.getLayer('custom-hs-layer')) {
    map.addLayer({
      id: 'custom-hs-layer',
      type: 'raster',
      source: 'custom-hs-src',
      layout: { visibility: customHillshadeActive ? 'visible' : 'none' },
      paint: { 'raster-opacity': 1.0 }
    }, 'active-claims-fill');
  }
}

function toggleCustomHillshade() {
  customHillshadeActive = !customHillshadeActive;
  const toggleEl = document.getElementById('custom-hs-toggle');
  if (toggleEl) {
    toggleEl.classList.toggle('on', customHillshadeActive);
    toggleEl.textContent = customHillshadeActive ? 'ON' : 'OFF';
  }
  const panel = document.getElementById('custom-hs-panel');
  if (panel) panel.style.display = customHillshadeActive ? 'block' : 'none';
  if (map && map.getLayer('custom-hs-layer')) {
    map.setLayoutProperty('custom-hs-layer', 'visibility',
      customHillshadeActive ? 'visible' : 'none');
  }
}

// ── LIDAR HILLSHADE — WATER MASK + COUNTER ──────────────
function syncLidarWaterMask() {
  if (!map || !map.getLayer('hillshade-water-mask')) return;
  const vis = (activeLidarStyles.size > 0) ? 'visible' : 'none';
  map.setLayoutProperty('hillshade-water-mask', 'visibility', vis);
}

function updateLidarActiveCount() {
  const el = document.getElementById('lidar-active-count');
  if (el) el.textContent = String(activeLidarStyles.size);
}
