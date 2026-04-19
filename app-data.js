// ==========================================================
// app-data.js — Unworked Gold data fetchers module
// Split from app.js, Session 8 commit 2 (April 19, 2026)
//
// CONTENTS: ~17 fetchX() functions that load GeoJSON / map data
// on demand when the user toggles a layer on:
//   Restricted lands: fetchNationalParks, fetchWilderness,
//     fetchOpenToClaim, fetchMonuments, fetchWildScenic,
//     fetchTribalLands, fetchMilitaryAreas
//   Infrastructure: fetchPLSS, fetchBLMRoads, fetchBLMBoundaries
//   Gold / MRDS minerals: fetchGoldOccurrences, fetchHistoricMines,
//     fetchMercury, fetchChromium, fetchCopper, fetchAntimony,
//     fetchSilver
//
// LOAD ORDER: after app.js (uses map, showStatus).
// Each function has a module-level "*Loaded" flag guard.
// Called from toggleLayer in app-layers.js.
// ==========================================================

// ── RESTRICTED LANDS FETCH ──────────────────────────────
let parksLoaded = false;
async function fetchNationalParks() {
  if (parksLoaded) return;
  showStatus('Loading national parks...');
  const bounds = map.getBounds();
  const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

  try {
    const res = await fetch(`https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Park_Boundaries/FeatureServer/0/query?where=1%3D1&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=UNIT_NAME%2CSTATE%2CUNIT_TYPE&returnGeometry=true&f=geojson&outSR=4326`);
    const data = await res.json();
    parksLoaded = true;
    map.getSource('natl-parks-src').setData(data);
    showStatus(`${data.features?.length || 0} national park units loaded`);
  } catch(e) {
    // Try alternate NPS endpoint
    try {
      const res2 = await fetch(`https://opendata.arcgis.com/datasets/b1598d3df2c047ef88251016af5b0f1e_0.geojson`);
      const data2 = await res2.json();
      parksLoaded = true;
      map.getSource('natl-parks-src').setData(data2);
      showStatus('National parks loaded');
    } catch(e2) {
      showStatus('National parks data unavailable');
      console.error('Parks load failed:', e2);
    }
  }
}

let wildernessLoaded = false;
async function fetchWilderness() {
  if (wildernessLoaded) return;
  showStatus('Loading wilderness areas...');
  const bounds = map.getBounds();
  const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

  try {
    const res = await fetch(`https://services1.arcgis.com/ERdCHt0sNM6dENSD/arcgis/rest/services/Wilderness_Areas_in_the_United_States/FeatureServer/0/query?where=1%3D1&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=NAME%2CSTATE%2CAGENCY&returnGeometry=true&f=geojson&outSR=4326`);
    const data = await res.json();
    wildernessLoaded = true;
    map.getSource('wilderness-src').setData(data);
    showStatus(`${data.features?.length || 0} wilderness areas loaded`);
  } catch(e) {
    showStatus('Wilderness data unavailable');
    console.error('Wilderness load failed:', e);
  }
}

// ── OPEN TO CLAIM FETCH ─────────────────────────────────
let openToClaimLoaded = false;
async function fetchOpenToClaim() {
  if (openToClaimLoaded) return;
  showStatus('Loading open BLM land...');
  const bounds = map.getBounds();
  const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

  try {
    // Query BLM SMA for BLM-only land (adm_code = BLM)
    const res = await fetch(`https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/0/query?where=ADM_CODE%3D'BLM'&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=ADM_CODE%2CSTATE_FIPS&returnGeometry=true&f=geojson&outSR=4326`);
    const data = await res.json();
    openToClaimLoaded = true;
    map.getSource('open-to-claim-src').setData(data);
    showStatus(`${data.features?.length || 0} open BLM areas loaded`);
  } catch(e) {
    showStatus('Open land data unavailable');
    console.error('Open to claim fetch failed:', e);
  }
}

// ── MONUMENTS / WSR / TRIBAL FETCH ──────────────────────
let monumentsLoaded = false;
async function fetchMonuments() {
  if (monumentsLoaded) return;
  showStatus('Loading national monuments...');
  const bounds = map.getBounds();
  const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
  try {
    const res = await fetch(`https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_National_Monuments_and_NSAs/MapServer/1/query?where=1%3D1&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=NAME%2CSTATE%2CMANAGING_AGENCY&returnGeometry=true&f=geojson&outSR=4326`);
    const data = await res.json();
    monumentsLoaded = true;
    map.getSource('monuments-src').setData(data);
    showStatus(`${data.features?.length || 0} national monuments loaded`);
  } catch(e) {
    showStatus('Monument data unavailable');
    console.error(e);
  }
}

let wsrLoaded = false;
async function fetchWildScenic() {
  if (wsrLoaded) return;
  showStatus('Loading Wild & Scenic Rivers...');
  try {
    const res = await fetch(`https://opendata.arcgis.com/datasets/2e3d5ddd3db04a12a81f6e88dbb16e72_0.geojson`);
    const data = await res.json();
    wsrLoaded = true;
    map.getSource('wsr-src').setData(data);
    showStatus(`Wild & Scenic Rivers loaded`);
  } catch(e) {
    showStatus('Wild & Scenic Rivers data unavailable');
    console.error(e);
  }
}

let tribalLoaded = false;
async function fetchTribalLands() {
  if (tribalLoaded) return;
  showStatus('Loading tribal lands...');
  const bounds = map.getBounds();
  const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
  try {
    const res = await fetch(`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/16/query?where=1%3D1&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=NAME%2CAIANNHCE&returnGeometry=true&f=geojson&outSR=4326`);
    const data = await res.json();
    tribalLoaded = true;
    map.getSource('tribal-src').setData(data);
    showStatus(`Tribal lands loaded`);
  } catch(e) {
    showStatus('Tribal lands data unavailable');
    console.error(e);
  }
}

let militaryLoaded = false;
async function fetchMilitaryAreas() {
  if (militaryLoaded) return;
  showStatus('Loading military areas...');
  const bounds = map.getBounds();
  const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
  try {
    const res = await fetch(`https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/DOD_Military_Installations_Boundaries/FeatureServer/0/query?where=1%3D1&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=Mng_Name,Unit_Nm&returnGeometry=true&f=geojson&outSR=4326`);
    const data = await res.json();
    militaryLoaded = true;
    map.getSource('military-src').setData(data);
    showStatus(`${data.features?.length || 0} military areas loaded`);
  } catch(e) {
    showStatus('Military data unavailable');
    console.error(e);
  }
}

let plssLoaded = false;
async function fetchPLSS() {
  if (plssLoaded) return;
  showStatus('Loading PLSS survey grid...');
  const bounds = map.getBounds();
  const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
  try {
    const res = await fetch(`https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/1/query?where=1%3D1&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=TWNSHPLAB&returnGeometry=true&f=geojson&outSR=4326`);
    const data = await res.json();
    plssLoaded = true;
    map.getSource('plss-src').setData(data);
    showStatus(`PLSS grid loaded`);
  } catch(e) {
    showStatus('PLSS data unavailable');
    console.error(e);
  }
}

let blmRoadsLoaded = false;
async function fetchBLMRoads() {
  if (blmRoadsLoaded) return;
  showStatus('Loading BLM roads...');
  const bounds = map.getBounds();
  const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
  try {
    const res = await fetch(`https://gis.blm.gov/arcgis/rest/services/transportation/BLM_Natl_Transportation/MapServer/0/query?where=1%3D1&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=ROUTE_NAME,SURFACE_TYPE&returnGeometry=true&f=geojson&outSR=4326`);
    const data = await res.json();
    blmRoadsLoaded = true;
    map.getSource('blm-roads-src').setData(data);
    showStatus(`BLM roads loaded`);
  } catch(e) {
    showStatus('BLM roads data unavailable');
    console.error(e);
  }
}

// ── BLM BOUNDARIES FETCH ────────────────────────────────
let blmLoaded = false;
function fetchBLMBoundaries() {
  if (blmLoaded) return;
  showStatus('Loading land boundaries...');
  const bounds = map.getBounds();
  const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

  fetch(`https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/0/query?where=1%3D1&geometry=${bbox}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=ADM_CODE%2CAGENCY_CODE%2CSTATE_FIPS&returnGeometry=true&f=geojson&outSR=4326`)
    .then(r => r.json())
    .then(data => {
      blmLoaded = true;
      if (data.features) {
        data.features.forEach(f => {
          f.properties.adm_code = f.properties.ADM_CODE || f.properties.adm_code || 'BLM';
        });
      }
      map.getSource('blm-surface-src').setData(data);
      showStatus('Land boundaries loaded');
    })
    .catch(e => {
      showStatus('Land boundary data unavailable');
      console.log('BLM boundaries failed:', e);
    });
}

// ── MRDS DATA FROM SUPABASE ─────────────────────────────
let goldLoaded = false;
async function fetchGoldOccurrences(silent = false) {
  if (!sbClient) { showStatus('Auth not ready'); return; }
  if (!silent) showStatus('Loading gold occurrences...');

  const bounds = map.getBounds();
  try {
    const { data, error } = await sbClient
      .from('mrds_sites')
      .select('dep_id, site_name, latitude, longitude, commod1, commod2, commod3, county, state, ore, dev_stat, prod_size')
      .or('commod1.ilike.%gold%,commod2.ilike.%gold%,commod3.ilike.%gold%')
      .gte('latitude', bounds.getSouth())
      .lte('latitude', bounds.getNorth())
      .gte('longitude', bounds.getWest())
      .lte('longitude', bounds.getEast())
      .limit(500);

    if (error) throw error;
    goldLoaded = true;

    const features = (data || []).map(r => ({
      type: 'Feature',
      properties: {
        name: r.site_name,
        dep_id: r.dep_id,
        commod1: r.commod1,
        commod2: r.commod2,
        commod3: r.commod3,
        county: r.county,
        state: r.state,
        ore: r.ore,
        dev_stat: r.dev_stat,
        prod_size: r.prod_size
      },
      geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] }
    }));

    map.getSource('gold-occurrences-src').setData({ type: 'FeatureCollection', features });
    showStatus(`${features.length} gold occurrences loaded`);
  } catch(e) {
    showStatus('Error loading gold data');
    console.error(e);
  }
}

let minesLoaded = false;
async function fetchHistoricMines(silent = false) {
  if (!sbClient) { showStatus('Auth not ready'); return; }
  if (!silent) showStatus('Loading historic mines...');

  const bounds = map.getBounds();
  try {
    const { data, error } = await sbClient
      .from('mrds_sites')
      .select('dep_id, site_name, latitude, longitude, commod1, oper_type, dep_type, dev_stat, county, state')
      .gte('latitude', bounds.getSouth())
      .lte('latitude', bounds.getNorth())
      .gte('longitude', bounds.getWest())
      .lte('longitude', bounds.getEast())
      .limit(500);

    if (error) throw error;
    minesLoaded = true;

    const features = (data || []).map(r => ({
      type: 'Feature',
      properties: {
        name: r.site_name,
        dep_id: r.dep_id,
        commod1: r.commod1,
        oper_type: r.oper_type,
        dep_type: r.dep_type,
        dev_stat: r.dev_stat,
        county: r.county,
        state: r.state
      },
      geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] }
    }));

    map.getSource('hist-mines-src').setData({ type: 'FeatureCollection', features });
    showStatus(`${features.length} mine sites loaded`);
  } catch(e) {
    showStatus('Error loading mine data');
    console.error(e);
  }
}

let mercuryLoaded = false;
async function fetchMercury(silent = false) {
  if (!sbClient) { showStatus('Auth not ready'); return; }
  if (!silent) showStatus('Loading mercury occurrences...');

  const bounds = map.getBounds();
  try {
    const { data, error } = await sbClient
      .from('mrds_sites')
      .select('dep_id, site_name, latitude, longitude, commod1, county, state, dev_stat')
      .or('commod1.ilike.%mercury%,commod2.ilike.%mercury%')
      .gte('latitude', bounds.getSouth())
      .lte('latitude', bounds.getNorth())
      .gte('longitude', bounds.getWest())
      .lte('longitude', bounds.getEast())
      .limit(500);

    if (error) throw error;
    mercuryLoaded = true;

    const features = (data || []).map(r => ({
      type: 'Feature',
      properties: {
        name: r.site_name,
        dep_id: r.dep_id,
        commod1: r.commod1,
        county: r.county,
        state: r.state,
        dev_stat: r.dev_stat
      },
      geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] }
    }));

    map.getSource('mercury-src').setData({ type: 'FeatureCollection', features });
    showStatus(`${features.length} mercury sites loaded`);
  } catch(e) {
    showStatus('Error loading mercury data');
    console.error(e);
  }
}

let chromiumLoaded = false;
async function fetchChromium(silent = false) {
  if (!sbClient) { showStatus('Auth not ready'); return; }
  if (!silent) showStatus('Loading chromium occurrences...');

  const bounds = map.getBounds();
  try {
    const { data, error } = await sbClient
      .from('mrds_sites')
      .select('dep_id, site_name, latitude, longitude, commod1, county, state, dev_stat')
      .or('commod1.ilike.%chromium%,commod2.ilike.%chromium%')
      .gte('latitude', bounds.getSouth())
      .lte('latitude', bounds.getNorth())
      .gte('longitude', bounds.getWest())
      .lte('longitude', bounds.getEast())
      .limit(500);

    if (error) throw error;
    chromiumLoaded = true;

    const features = (data || []).map(r => ({
      type: 'Feature',
      properties: {
        name: r.site_name,
        dep_id: r.dep_id,
        commod1: r.commod1,
        county: r.county,
        state: r.state,
        dev_stat: r.dev_stat
      },
      geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] }
    }));

    map.getSource('chromium-src').setData({ type: 'FeatureCollection', features });
    showStatus(`${features.length} chromium sites loaded`);
  } catch(e) {
    showStatus('Error loading chromium data');
    console.error(e);
  }
}

let copperLoaded = false;
async function fetchCopper(silent = false) {
  if (!sbClient) { showStatus('Auth not ready'); return; }
  if (!silent) showStatus('Loading copper occurrences...');

  const bounds = map.getBounds();
  try {
    const { data, error } = await sbClient
      .from('mrds_sites')
      .select('dep_id, site_name, latitude, longitude, commod1, county, state, dev_stat')
      .or('commod1.ilike.%copper%,commod2.ilike.%copper%')
      .gte('latitude', bounds.getSouth())
      .lte('latitude', bounds.getNorth())
      .gte('longitude', bounds.getWest())
      .lte('longitude', bounds.getEast())
      .limit(500);

    if (error) throw error;
    copperLoaded = true;

    const features = (data || []).map(r => ({
      type: 'Feature',
      properties: {
        name: r.site_name,
        dep_id: r.dep_id,
        commod1: r.commod1,
        county: r.county,
        state: r.state,
        dev_stat: r.dev_stat
      },
      geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] }
    }));

    map.getSource('copper-src').setData({ type: 'FeatureCollection', features });
    showStatus(`${features.length} copper sites loaded`);
  } catch(e) {
    showStatus('Error loading copper data');
    console.error(e);
  }
}

let antimonyLoaded = false;
async function fetchAntimony(silent = false) {
  if (!sbClient) { showStatus('Auth not ready'); return; }
  if (!silent) showStatus('Loading antimony occurrences...');

  const bounds = map.getBounds();
  try {
    const { data, error } = await sbClient
      .from('mrds_sites')
      .select('dep_id, site_name, latitude, longitude, commod1, county, state, dev_stat')
      .or('commod1.ilike.%antimony%,commod2.ilike.%antimony%')
      .gte('latitude', bounds.getSouth())
      .lte('latitude', bounds.getNorth())
      .gte('longitude', bounds.getWest())
      .lte('longitude', bounds.getEast())
      .limit(500);

    if (error) throw error;
    antimonyLoaded = true;

    const features = (data || []).map(r => ({
      type: 'Feature',
      properties: {
        name: r.site_name,
        dep_id: r.dep_id,
        commod1: r.commod1,
        county: r.county,
        state: r.state,
        dev_stat: r.dev_stat
      },
      geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] }
    }));

    map.getSource('antimony-src').setData({ type: 'FeatureCollection', features });
    showStatus(`${features.length} antimony sites loaded`);
  } catch(e) {
    showStatus('Error loading antimony data');
    console.error(e);
  }
}

let silverLoaded = false;
async function fetchSilver(silent = false) {
  if (!sbClient) { showStatus('Auth not ready'); return; }
  if (!silent) showStatus('Loading silver occurrences...');

  const bounds = map.getBounds();
  try {
    const { data, error } = await sbClient
      .from('mrds_sites')
      .select('dep_id, site_name, latitude, longitude, commod1, county, state, dev_stat')
      .or('commod1.ilike.%silver%,commod2.ilike.%silver%')
      .gte('latitude', bounds.getSouth())
      .lte('latitude', bounds.getNorth())
      .gte('longitude', bounds.getWest())
      .lte('longitude', bounds.getEast())
      .limit(500);

    if (error) throw error;
    silverLoaded = true;

    const features = (data || []).map(r => ({
      type: 'Feature',
      properties: {
        name: r.site_name,
        dep_id: r.dep_id,
        commod1: r.commod1,
        county: r.county,
        state: r.state,
        dev_stat: r.dev_stat
      },
      geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] }
    }));

    map.getSource('silver-src').setData({ type: 'FeatureCollection', features });
    showStatus(`${features.length} silver sites loaded`);
  } catch(e) {
    showStatus('Error loading silver data');
    console.error(e);
  }
}
