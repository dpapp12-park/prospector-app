// ==========================================================
// app-lidar.js — Unworked Gold LiDAR hillshade module
// Split from app.js, Session 8 commit 2 (April 19, 2026)
//
// CONTENTS:
//   STATE:     LIDAR_STYLES (10 styles), activeLidarStyles,
//              customHillshadeParams, lidarCustomDebounceTimer,
//              customHillshadeActive
//   BUILDERS:  buildLidarSourceUrl, buildCustomHillshadeUrl
//   LIFECYCLE: registerLidarLayers, registerCustomHillshadeLayer
//   TOGGLES:   toggleLidarStyle, toggleCustomHillshade
//   CONTROLS:  updateCustomParam, resetCustomHillshade
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
    paint: { 'raster-contrast': 0.35, 'raster-brightness-max': 0.92 } },     /* Step 5 / spec 3.8.1: opacity 1.0 removed so the global 0.7 default applies */
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
// activeLidarStyles tracks which styles the user has toggled on. Default
// per-layer opacity is 0.7 (spec 3.8.1) and is set on the layer's paint
// when registerLidarLayers adds it to the map. The legacy focused-style
// state model and its per-layer opacity-storage object were removed
// Session 38 once Step 1 stripped the focused-only opacity slider;
// Step 6 will reintroduce per-active-row sliders without resurrecting
// either piece of legacy state.
let activeLidarStyles = new Set();
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
// Adds raster source/layer pairs, inserted BELOW the basemap label
// layer so place names + road shields stay readable on top of the
// hillshade. (Spec 3.8.1, Step 5 fix — was 'active-claims-fill'
// which sat above labels and made the map unusable in the field.)
// Visibility per-layer reflects activeLidarStyles Set. Opacity is
// the global default 0.7 (spec 3.8.1); Step 6 will reintroduce
// per-active-row opacity sliders without resurrecting the focused-
// style state model. Per-style paint tuning (e.g. contrast for
// Multidirectional) comes from the style.paint field in LIDAR_STYLES.

// Returns the id of the first symbol layer whose id contains "label",
// so addLayer(..., id) inserts a raster BELOW it. If none found
// (e.g. style still loading), returns undefined which appends to top.
function _belowLabelsBeforeId() {
  if (!map) return undefined;
  try {
    const layers = (map.getStyle() || {}).layers || [];
    const lyr = layers.find(l => l.type === 'symbol' && /label/i.test(l.id));
    return lyr ? lyr.id : undefined;
  } catch (e) {
    return undefined;
  }
}

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
      // Default opacity 0.7 (spec 3.8.1), with per-style paint overrides
      // (e.g. contrast boost for Multidirectional). Step 6 will layer
      // per-active-row opacity overrides on top via setPaintProperty.
      const paint = Object.assign({ 'raster-opacity': 0.7 }, style.paint || {});
      map.addLayer({
        id: lyrId,
        type: 'raster',
        source: srcId,
        layout: { visibility: activeLidarStyles.has(style.id) ? 'visible' : 'none' },
        paint: paint
      }, _belowLabelsBeforeId());
    }
  });
  // On first mount, mirror state to DOM (handles setStyle re-init too).
  updateLidarActiveCount();
}

// ── LIDAR HILLSHADE — TOGGLE ─────────────────────────────
// Click behavior (post-Session-38, focused-style model removed):
//   inactive row → activate
//   active row   → deactivate
// Zero-active is allowed (Finding #1a, Session 24). Step 6 will add
// per-active-row opacity sliders that don't depend on a focused style.
function toggleLidarStyle(styleId) {
  const style = LIDAR_STYLES.find(s => s.id === styleId);
  if (!style) return;

  if (activeLidarStyles.has(styleId)) {
    activeLidarStyles.delete(styleId);
  } else {
    activeLidarStyles.add(styleId);
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

  syncLidarWaterMask();
  updateLidarActiveCount();
  updateActiveLayerBar();
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
      paint: { 'raster-opacity': 0.7 }     /* Step 5 / spec 3.8.1 */
    }, _belowLabelsBeforeId());            /* Step 5 / spec 3.8.1: insert below basemap labels */
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
  if (panel) {
    panel.style.display = customHillshadeActive ? 'block' : 'none';
    if (customHillshadeActive) panel.classList.remove('minimized');
  }
  if (map && map.getLayer('custom-hs-layer')) {
    map.setLayoutProperty('custom-hs-layer', 'visibility',
      customHillshadeActive ? 'visible' : 'none');
  }
}

function customHsMinimize() {
  const panel = document.getElementById('custom-hs-panel');
  if (!panel) return;
  panel.classList.toggle('minimized');
  document.getElementById('custom-hs-min').innerHTML =
    panel.classList.contains('minimized') ? '&#43;' : '&#8722;';
}

function customHsClose() {
  // Hide the panel and turn off the layer
  if (customHillshadeActive) toggleCustomHillshade();
  else {
    const panel = document.getElementById('custom-hs-panel');
    if (panel) panel.style.display = 'none';
  }
}

// Drag logic — attached once on first show
(function _initChsDrag() {
  document.addEventListener('DOMContentLoaded', () => {
    const panel = document.getElementById('custom-hs-panel');
    const handle = document.getElementById('custom-hs-drag');
    if (!panel || !handle) return;
    let dragging = false, ox = 0, oy = 0;
    handle.addEventListener('mousedown', e => {
      if (e.target.classList.contains('custom-hs-btn')) return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      panel.style.left   = (e.clientX - ox) + 'px';
      panel.style.top    = (e.clientY - oy) + 'px';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  });
}());

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
