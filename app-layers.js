// ==========================================================
// app-layers.js — Unworked Gold map layers module
// Split from app.js, Session 8 commit 1 (April 19, 2026)
//
// CONTENTS (in order):
//   1. addDemoLayers()            — registers every Mapbox source/layer
//   2. toggleLayer / toggleLayers / toggleGroup — user-facing toggles
//   3. LAYER_CHIP_LABELS + updateActiveLayerBar() — active-layer indicator bar
//   4. LAYER_DESCRIPTIONS + tooltip state + showLayerInfo/hideTooltip
//
// LOAD ORDER: must load AFTER app.js, which declares shared globals
//   (layerState, map, userLocation, fetchX data functions, showStatus,
//    updateRestrictionLegend, checkProStatus, LIDAR_STYLES, etc.).
//
// GLOBAL SCOPE: all functions here are plain `function` declarations.
// Inline onclick="..." handlers in index.html resolve via those globals.
// ==========================================================

function addDemoLayers() {
  // ── ACTIVE CLAIMS (real BLM Oregon data) ──
  map.addSource('active-claims-src', {
    type: 'vector',
    url: 'mapbox://dpapp12.27rqahpv'
  });

  map.addLayer({
    id: 'active-claims-fill',
    type: 'fill',
    source: 'active-claims-src',
    'source-layer': 'active_claims_final-0xk0t5',
    paint: {
      'fill-color': '#4CAF50',
      'fill-opacity': 0
    }
  });

  map.addLayer({
    id: 'active-claims-line',
    type: 'line',
    source: 'active-claims-src',
    'source-layer': 'active_claims_final-0xk0t5',
    paint: {
      'line-color': '#4CAF50',
      'line-width': 1.5,
      'line-opacity': 0.8
    }
  });

  // ── CLOSED CLAIMS (5 chunk tilesets covering all states) ──
  const closedChunks = [
    { src: 'closed-claims-src-1', url: 'mapbox://dpapp12.dqfqxgls', layer: 'closed_chunk1_final-6bq2q0' }, // AZ+AK
    { src: 'closed-claims-src-2', url: 'mapbox://dpapp12.agbghasg', layer: 'closed_chunk2_final-5aup0r' }, // CA+CO
    { src: 'closed-claims-src-3', url: 'mapbox://dpapp12.2lqdpwmm', layer: 'closed_chunk3_final-4fjt04' }, // NM+NV+MT
    { src: 'closed-claims-src-4', url: 'mapbox://dpapp12.656yl9tr', layer: 'closed_chunk4_final-5pe3z1' }, // WY+UT
    { src: 'closed-claims-src-5', url: 'mapbox://dpapp12.bn68xn7f', layer: 'closed_chunk5_final-1yixbn' }, // OR+ID
  ];

  closedChunks.forEach(({ src, url, layer }, i) => {
    const n = i + 1;
    map.addSource(src, { type: 'vector', url });
    map.addLayer({
      id: `closed-claims-fill-${n}`,
      type: 'fill',
      source: src,
      'source-layer': layer,
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#F44336', 'fill-opacity': 0 }
    });
    map.addLayer({
      id: `closed-claims-line-${n}`,
      type: 'line',
      source: src,
      'source-layer': layer,
      layout: { visibility: 'none' },
      paint: { 'line-color': '#F44336', 'line-width': 1, 'line-opacity': 0.6 }
    });
  });

  // ── POPUPS ──
  map.on('click', 'active-claims-fill', (e) => {
    const props = e.features[0].properties;
    const name = props.CSE_NM || props.cse_nm || props.CSE_NM_MLRS || 'Mining Claim';
    const serial = props.CSE_NR || props.cse_nr || '';
    const rawType = props.BLM_PROD || props.blm_prod || '';
    const acres = props.GIS_ACRES || props.gis_acres;
    const blmOrg = props.BLM_ORG_CD || props.blm_org_cd || '';
    const expiryRaw = props.CSE_EXP_DT || props.cse_exp_dt || '';
    const filedRaw = props.CSE_DISP_DT || props.cse_disp_dt || '';
    const { lng, lat } = e.lngLat;

    // Format dates
    const fmtDate = (d) => {
      if (!d) return '—';
      try { return new Date(d).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }); }
      catch { return d; }
    };
    const expiry = fmtDate(expiryRaw);
    const filed  = fmtDate(filedRaw);

    // Distance from user
    const distStr = userLocation
      ? (() => { const d = distanceMiles(userLocation.lat, userLocation.lng, lat, lng); return d < 1 ? `${(d * 5280).toFixed(0)} ft away` : `${d.toFixed(1)} mi away`; })()
      : null;

    const claimTypeMap = {
      'LODE CLAIM':   { label: 'Lode Claim',   desc: 'Hardrock gold in quartz veins — requires drilling', icon: '⛏️' },
      'PLACER CLAIM': { label: 'Placer Claim',  desc: 'Gold in stream gravels — ideal for panning & detecting', icon: '🏅' },
      'MILL SITE':    { label: 'Mill Site',     desc: 'Processing facility land, not a mining claim', icon: '🏭' },
      'TUNNEL SITE':  { label: 'Tunnel Site',   desc: 'Access tunnel to underground workings', icon: '🕳️' }
    };
    const claimInfo = claimTypeMap[rawType.toUpperCase()] || { label: rawType || 'Unknown', desc: '', icon: '⛏️' };

    const blmOrgMap = {
      'ORMED':'Medford FO','ORBUR':'Burns District','ORCOO':'Coos Bay District',
      'OREUG':'Eugene District','ORSAK':'Klamath Falls FO','ORPRI':'Prineville District',
      'ORSRO':'Roseburg District','ORVAL':'Vale District'
    };
    const fieldOffice = blmOrgMap[blmOrg] || (blmOrg ? `BLM ${blmOrg}` : 'BLM Oregon');

    const countyRecorderMap = {
      'BAKER':'https://www.bakercounty.org/clerk','BENTON':'https://www.co.benton.or.us/clerk',
      'CLACKAMAS':'https://www.clackamas.us/elections/recording.html',
      'COOS':'https://www.co.coos.or.us/countyclerk','CROOK':'https://www.co.crook.or.us/county-clerk',
      'CURRY':'https://www.co.curry.or.us/government/elected-officials/county-clerk',
      'DESCHUTES':'https://www.deschutes.org/county-clerk','DOUGLAS':'https://www.co.douglas.or.us/clerk',
      'GRANT':'https://www.grantcounty.org/government/county-clerk','HARNEY':'https://www.co.harney.or.us/county-clerk',
      'JACKSON':'https://www.jacksoncounty.org/county-clerk','JEFFERSON':'https://www.co.jefferson.or.us/county-clerk',
      'JOSEPHINE':'https://www.co.josephine.or.us/county-clerk','KLAMATH':'https://klamathcounty.org/county-clerk',
      'LAKE':'https://www.lakecountyor.org/county-clerk','LANE':'https://www.lanecounty.org/county_clerk',
      'LINN':'https://www.co.linn.or.us/county-clerk','MALHEUR':'https://www.malheurco.org/county-clerk',
      'MARION':'https://www.co.marion.or.us/CO/CountyClerk','MORROW':'https://www.co.morrow.or.us/county-clerk',
      'MULTNOMAH':'https://multco.us/county-clerk','UMATILLA':'https://www.umatillacounty.net/county-clerk',
      'UNION':'https://www.union-county.org/county-clerk','WALLOWA':'https://www.co.wallowa.or.us/county-clerk',
      'WASCO':'https://www.co.wasco.or.us/county-clerk','WASHINGTON':'https://www.co.washington.or.us/AssessmentTaxation/RecordingElections',
      'YAMHILL':'https://www.co.yamhill.or.us/content/county-clerk'
    };

    // Nearby counts from rendered features
    const radiusDeg = 0.03;
    const bbox = [
      map.project([lng - radiusDeg, lat - radiusDeg]),
      map.project([lng + radiusDeg, lat + radiusDeg])
    ];
    const nearbyActive = Math.max(0, map.queryRenderedFeatures(bbox, { layers: ['active-claims-fill'] }).length - 1);
    const nearbyClosed = map.queryRenderedFeatures(bbox, { layers: ['closed-claims-fill-1','closed-claims-fill-2','closed-claims-fill-3','closed-claims-fill-4','closed-claims-fill-5'] }).length;
    const nearbyGold   = map.queryRenderedFeatures(bbox, { layers: ['gold-occurrences-layer'] }).length;
    const nearbyMines  = map.queryRenderedFeatures(bbox, { layers: ['hist-mines-layer'] });
    const mineNames    = [...new Set(nearbyMines.map(f => f.properties.name || f.properties.site_name).filter(Boolean))].slice(0,2).join(', ');

    const srpUrl    = `https://reports.blm.gov/reports/MLRS/SRP?sn=${serial}`;
    const mlrsUrl   = `https://mlrs.blm.gov/s/mining-claims?serialNumber=${serial}`;

    const popup = new mapboxgl.Popup({ closeButton: false, maxWidth: '300px' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;background:#0D0C09;border:1px solid rgba(201,168,76,0.35);border-radius:12px;padding:16px;color:#E8D9B0;width:280px;position:relative">

          <!-- Close button -->
          <button onclick="this.closest('.mapboxgl-popup').remove()" style="position:absolute;top:10px;right:10px;background:rgba(255,255,255,0.08);border:none;color:#9A8A6A;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;line-height:1">✕</button>

          <!-- Name & serial -->
          <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#F0C040;letter-spacing:0.06em;padding-right:30px">${name}</div>
          <div style="font-family:'DM Mono',monospace;font-size:10px;color:#6B6248;margin-top:2px">${serial}</div>

          <!-- Type badge -->
          <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span style="background:rgba(76,175,80,0.15);border:1px solid rgba(76,175,80,0.4);border-radius:20px;padding:3px 10px;font-size:11px;font-family:'DM Mono',monospace;color:#4CAF50">● ACTIVE</span>
            <span style="background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);border-radius:20px;padding:3px 10px;font-size:11px;font-family:'DM Mono',monospace;color:#C9A84C">${claimInfo.icon} ${claimInfo.label}</span>
          </div>
          ${claimInfo.desc ? `<div style="font-size:11px;color:#6B6248;margin-top:5px">${claimInfo.desc}</div>` : ''}

          <!-- Key details -->
          <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.06);padding-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
              <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#4A4030">Acreage</div>
              <div style="font-size:13px;font-weight:500;margin-top:2px">${acres ? parseFloat(acres).toFixed(1) + ' ac' : '—'}</div>
            </div>
            <div>
              <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#4A4030">Elevation</div>
              <div style="font-size:13px;font-weight:500;margin-top:2px" id="popup-elev-${serial}">Loading...</div>
            </div>
            <div>
              <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#4A4030">County</div>
              <div style="font-size:13px;font-weight:500;margin-top:2px" id="popup-county-${serial}">Loading...</div>
            </div>
            <div>
              <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#4A4030">Distance</div>
              <div style="font-size:13px;font-weight:500;margin-top:2px" id="popup-dist-${serial}">—</div>
            </div>
            <div>
              <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#4A4030">Disposition Date</div>
              <div style="font-size:13px;font-weight:500;margin-top:2px" id="popup-filed-${serial}">Loading...</div>
            </div>
            <div>
              <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#4A4030">Expires</div>
              <div style="font-size:13px;font-weight:500;margin-top:2px" id="popup-expiry-${serial}">Loading...</div>
            </div>
            <div style="grid-column:1/-1">
              <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#4A4030">Field Office</div>
              <div style="font-size:12px;font-weight:500;margin-top:2px">${fieldOffice}</div>
            </div>
          </div>

          <!-- Nearby -->
          <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px">
            <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#4A4030;margin-bottom:8px">Within ~2 miles</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;text-align:center">
              <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:6px 4px">
                <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:#4CAF50">${nearbyActive}</div>
                <div style="font-family:'DM Mono',monospace;font-size:8px;color:#4A4030;line-height:1.3">Active Claims</div>
              </div>
              <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:6px 4px">
                <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:#F44336">${nearbyClosed}</div>
                <div style="font-family:'DM Mono',monospace;font-size:8px;color:#4A4030;line-height:1.3">Closed Claims</div>
              </div>
              <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:6px 4px">
                <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:#F0C040">${nearbyGold}</div>
                <div style="font-family:'DM Mono',monospace;font-size:8px;color:#4A4030;line-height:1.3">USGS Gold Records</div>
              </div>
              <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:6px 4px">
                <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:#FF6F00">${nearbyMines.length}</div>
                <div style="font-family:'DM Mono',monospace;font-size:8px;color:#4A4030;line-height:1.3">Historic Mines</div>
              </div>
            </div>
            ${mineNames ? `<div style="font-size:11px;color:#6B6248;margin-top:6px">🕳️ ${mineNames}</div>` : ''}
          </div>

          <!-- Record links -->
          <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px;display:flex;gap:6px">
            <a href="${srpUrl}" target="_blank" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:7px 4px;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.04em;color:#C9A84C;text-decoration:none;text-align:center">SRP ↗</a>
            <a href="${mlrsUrl}" target="_blank" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:7px 4px;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.04em;color:#C9A84C;text-decoration:none;text-align:center">MLRS ↗</a>
            <a href="#" id="popup-recorder-${serial}" target="_blank" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:7px 4px;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.04em;color:#C9A84C;text-decoration:none;text-align:center">Recorder ↗</a>
          </div>

          <!-- Action buttons -->
          <div style="margin-top:8px;display:flex;gap:8px">
            <button onclick="saveClaim('${serial}','${name.replace(/'/g,"\\'")}','${rawType}',${acres||0})" style="flex:1;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.4);border-radius:8px;padding:10px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;color:#F0C040;cursor:pointer">⭐ Save</button>
            <button onclick="watchClaim('${serial}','${name.replace(/'/g,"\\'")}'')" style="flex:1;background:rgba(33,150,243,0.1);border:1px solid rgba(33,150,243,0.3);border-radius:8px;padding:10px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;color:#64B5F6;cursor:pointer">🔔 Watch</button>
          </div>
        </div>
      `)
      .addTo(map);

    // Fetch elevation async
    fetch(`https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Feet&includeDate=false`)
      .then(r => r.json())
      .then(d => {
        const el = document.getElementById(`popup-elev-${serial}`);
        if (el) el.textContent = d.value ? `${Math.round(d.value).toLocaleString()} ft` : '—';
      }).catch(() => {
        const el = document.getElementById(`popup-elev-${serial}`);
        if (el) el.textContent = '—';
      });

    // Fetch county async
    fetch(`https://geo.fcc.gov/api/census/block/find?latitude=${lat}&longitude=${lng}&format=json`)
      .then(r => r.json())
      .then(d => {
        const county = d.County?.name?.replace(' County','').toUpperCase();
        const el = document.getElementById(`popup-county-${serial}`);
        if (el && county) el.textContent = county + ' Co.';
        const recLink = document.getElementById(`popup-recorder-${serial}`);
        if (recLink && county) {
          recLink.href = countyRecorderMap[county] || `https://www.google.com/search?q=${encodeURIComponent(county+' County Oregon recorder')}`;
        }
      }).catch(() => {
        const el = document.getElementById(`popup-county-${serial}`);
        if (el) el.textContent = '—';
      });

    // Fetch filed + expiry dates from Supabase
    if (sbClient && serial) {
      sbClient.from('mining_claims_active')
        .select('cse_disp_dt, cse_exp_dt')
        .eq('cse_nr', serial)
        .single()
        .then(({ data }) => {
          const filedEl  = document.getElementById(`popup-filed-${serial}`);
          const expiryEl = document.getElementById(`popup-expiry-${serial}`);
          const fmt = (d) => d ? new Date(d).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '—';
          if (filedEl)  filedEl.textContent  = fmt(data?.cse_disp_dt);
          if (expiryEl) {
            const expDate = data?.cse_exp_dt ? new Date(data.cse_exp_dt) : null;
            if (expiryEl && expDate) {
              const isExpiringSoon = expDate < new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
              expiryEl.textContent = fmt(data.cse_exp_dt);
              if (isExpiringSoon) expiryEl.style.color = '#FF9800';
            } else if (expiryEl) {
              expiryEl.textContent = '—';
            }
          }
        }).catch(() => {
          const filedEl  = document.getElementById(`popup-filed-${serial}`);
          const expiryEl = document.getElementById(`popup-expiry-${serial}`);
          if (filedEl)  filedEl.textContent  = '—';
          if (expiryEl) expiryEl.textContent = '—';
        });
    }

    // Distance from user's GPS position
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        const userLat = pos.coords.latitude;
        const userLng = pos.coords.longitude;
        const R = 3958.8; // miles
        const dLat = (lat - userLat) * Math.PI / 180;
        const dLng = (lng - userLng) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(userLat * Math.PI/180) * Math.cos(lat * Math.PI/180) * Math.sin(dLng/2)**2;
        const miles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distEl = document.getElementById(`popup-dist-${serial}`);
        if (distEl) distEl.textContent = miles < 0.1 ? 'Here' : miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
      }, () => {});
    }
  });

  ['closed-claims-fill-1','closed-claims-fill-2','closed-claims-fill-3','closed-claims-fill-4','closed-claims-fill-5'].forEach(layerId => {
  map.on('click', layerId, (e) => {
    const props = e.features[0].properties;
    const name = props.CSE_NAME || props.CSE_NM || props.cse_nm || 'Mining Claim';
    const serial = props.CSE_NR || props.cse_nr || '';
    const type = props.BLM_PROD || props.blm_prod || '';
    const acres = props.GIS_ACRES || props.gis_acres;
    new mapboxgl.Popup({ closeButton: false, maxWidth: '280px' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;background:#0D0C09;border:1px solid rgba(244,67,54,0.3);border-radius:12px;padding:16px;color:#E8D9B0;width:260px;position:relative">
          <button onclick="this.closest('.mapboxgl-popup').remove()" style="position:absolute;top:10px;right:10px;background:rgba(255,255,255,0.08);border:none;color:#9A8A6A;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">✕</button>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:#EF9A9A;letter-spacing:0.06em;padding-right:30px">${name}</div>
          <div style="font-family:'DM Mono',monospace;font-size:10px;color:#6B6248;margin-top:2px">${serial}</div>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            <span style="background:rgba(244,67,54,0.15);border:1px solid rgba(244,67,54,0.4);border-radius:20px;padding:3px 10px;font-size:11px;font-family:'DM Mono',monospace;color:#F44336">● CLOSED</span>
            ${type ? `<span style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:3px 10px;font-size:11px;font-family:'DM Mono',monospace;color:#9A8A6A">${type}</span>` : ''}
          </div>
          ${acres ? `<div style="font-size:12px;color:#6B6248;margin-top:8px">${parseFloat(acres).toFixed(1)} acres</div>` : ''}
          <div style="margin-top:10px;font-size:11px;color:#6B6248;background:rgba(244,67,54,0.06);border-radius:6px;padding:8px">This claim has lapsed or been abandoned. High density of closed claims is a strong indicator of past gold activity.</div>
          <div style="margin-top:10px;display:flex;gap:6px">
            <a href="https://reports.blm.gov/reports/MLRS/SRP?sn=${serial}" target="_blank" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:7px;font-family:'DM Mono',monospace;font-size:9px;color:#C9A84C;text-decoration:none;text-align:center">SRP ↗</a>
            <a href="https://mlrs.blm.gov/s/mining-claims?serialNumber=${serial}" target="_blank" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:7px;font-family:'DM Mono',monospace;font-size:9px;color:#C9A84C;text-decoration:none;text-align:center">MLRS ↗</a>
          </div>
        </div>
      `)
      .addTo(map);
  });
  }); // end closedChunks forEach click handlers

  // ── USGS STREAM GAUGES ──
  fetch('https://waterservices.usgs.gov/nwis/iv/?format=json&stateCd=or&parameterCd=00060&siteStatus=active&siteType=ST')
    .then(r => r.json())
    .then(data => {
      const features = (data.value?.timeSeries || []).map(ts => {
        const site = ts.sourceInfo;
        const val = ts.values?.[0]?.value?.[0]?.value;
        const flow = val ? parseFloat(val) : null;
        return {
          type: 'Feature',
          properties: {
            name: site.siteName,
            site_no: site.siteCode?.[0]?.value,
            flow_cfs: flow,
            flow_label: flow ? `${flow.toLocaleString()} cfs` : 'No data'
          },
          geometry: {
            type: 'Point',
            coordinates: [
              site.geoLocation?.geogLocation?.longitude || 0,
              site.geoLocation?.geogLocation?.latitude || 0
            ]
          }
        };
      }).filter(f => f.geometry.coordinates[0] !== 0);

      map.addSource('stream-gauges-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features }
      });

      map.addLayer({
        id: 'stream-gauges-layer',
        type: 'circle',
        source: 'stream-gauges-src',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 7,
          'circle-color': [
            'interpolate', ['linear'],
            ['coalesce', ['get', 'flow_cfs'], 0],
            0, '#2196F3',
            100, '#4CAF50',
            1000, '#FF9800',
            5000, '#F44336'
          ],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.85
        }
      });

      map.on('click', 'stream-gauges-layer', (e) => {
        const p = e.features[0].properties;
        new mapboxgl.Popup({ closeButton: false })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:'DM Sans',sans-serif;background:#1A1810;border:1px solid rgba(33,150,243,0.4);border-radius:10px;padding:12px 16px;color:#E8D9B0;min-width:180px">
              <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#2196F3;letter-spacing:0.06em">💧 ${p.name}</div>
              <div style="font-family:'DM Mono',monospace;font-size:11px;color:#6B6248;margin-top:2px">${p.site_no}</div>
              <div style="margin-top:8px;font-size:14px;color:#E8D9B0;font-weight:500">${p.flow_label}</div>
              <div style="margin-top:4px;font-size:11px;color:${
                p.flow_cfs < 50 ? '#4CAF50' :
                p.flow_cfs < 500 ? '#8BC34A' :
                p.flow_cfs < 2000 ? '#FF9800' : '#F44336'
              }">${
                !p.flow_cfs ? 'No current data' :
                p.flow_cfs < 50 ? '✅ Low water — ideal conditions' :
                p.flow_cfs < 500 ? '✅ Normal flow — wading possible' :
                p.flow_cfs < 2000 ? '⚠️ High water — use caution' :
                '🚫 Flood conditions — stay out'
              }</div>
              <div style="margin-top:8px">
                <a href="https://waterdata.usgs.gov/monitoring-location/${p.site_no}" target="_blank" style="font-family:'DM Mono',monospace;font-size:10px;color:#2196F3;text-decoration:none;padding:3px 8px;border:1px solid rgba(33,150,243,0.4);border-radius:4px;">USGS Data ↗</a>
              </div>
            </div>
          `)
          .addTo(map);
      });

      map.on('mouseenter', 'stream-gauges-layer', () => map.getCanvas().style.cursor = 'pointer');
      map.on('mouseleave', 'stream-gauges-layer', () => map.getCanvas().style.cursor = '');
    })
    .catch(e => console.log('Stream gauge load failed:', e));

  // ── USGS GOLD OCCURRENCES + HISTORIC MINES ──
  // Load on demand when toggled - not on startup
  map.addSource('gold-occurrences-src', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addLayer({
    id: 'gold-occurrences-layer',
    type: 'circle',
    source: 'gold-occurrences-src',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'],
        8, ['match', ['get', 'dev_stat'], 'Producer', 7, 'Past Producer', 6, 4],
        14, ['match', ['get', 'dev_stat'], 'Producer', 12, 'Past Producer', 10, 7]
      ],
      'circle-color': [
        'case',
        ['any',
          ['==', ['get', 'prod_size'], 'Y'],
          ['==', ['get', 'prod_size'], 'S'],
          ['==', ['get', 'prod_size'], 'M'],
          ['==', ['get', 'prod_size'], 'L']
        ],
        ['match', ['get', 'dev_stat'],
          'Producer', '#FFD700',
          'Past Producer', '#F0C040',
          'Prospect', '#FF9800',
          'Occurrence', '#A0A0A0',
          '#C9A84C'
        ],
        'hsla(0, 0%, 0%, 0)'
      ],
      'circle-stroke-color': [
        'match', ['get', 'dev_stat'],
        'Producer', '#FFD700',
        'Past Producer', '#F0C040',
        'Prospect', '#FF9800',
        'Occurrence', '#A0A0A0',
        '#C9A84C'
      ],
      'circle-stroke-width': [
        'case',
        ['any',
          ['==', ['get', 'prod_size'], 'Y'],
          ['==', ['get', 'prod_size'], 'S'],
          ['==', ['get', 'prod_size'], 'M'],
          ['==', ['get', 'prod_size'], 'L']
        ],
        1.5,
        2
      ],
      'circle-opacity': [
        'match', ['get', 'dev_stat'],
        'Producer', 1.0,
        'Past Producer', 0.95,
        'Prospect', 0.85,
        0.6
      ]
    }
  });

  map.addSource('hist-mines-src', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addLayer({
    id: 'hist-mines-layer',
    type: 'circle',
    source: 'hist-mines-src',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 8],
      'circle-color': '#FF6F00',
      'circle-stroke-color': '#BF360C',
      'circle-stroke-width': 1,
      'circle-opacity': 0.85
    }
  });

  // ── GOLD OCCURRENCES HEATMAP (placer-heatmap layer) ──
  // Reuses gold-occurrences-src — shows up as a density heat map
  map.addLayer({
    id: 'gold-heatmap-layer',
    type: 'heatmap',
    source: 'gold-occurrences-src',
    layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 14, 2.5],
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0,   'rgba(0,0,0,0)',
        0.15,'rgba(240,192,64,0.25)',
        0.4, 'rgba(240,150,0,0.55)',
        0.7, 'rgba(255,80,0,0.78)',
        1,   'rgba(220,20,20,0.95)'
      ],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 6, 18, 10, 30, 14, 50],
      'heatmap-opacity': 0.78
    }
  });

  // ── MINE SITES HEATMAP (lode-heatmap layer) ──
  // Reuses hist-mines-src — density of all USGS mine sites
  map.addLayer({
    id: 'mines-heatmap-layer',
    type: 'heatmap',
    source: 'hist-mines-src',
    layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 14, 2.5],
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0,   'rgba(0,0,0,0)',
        0.15,'rgba(255,111,0,0.25)',
        0.4, 'rgba(255,80,0,0.55)',
        0.7, 'rgba(200,30,0,0.78)',
        1,   'rgba(160,0,0,0.95)'
      ],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 6, 18, 10, 30, 14, 50],
      'heatmap-opacity': 0.78
    }
  });

  // ── MERCURY SOURCE + LAYER ──
  map.addSource('mercury-src', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addLayer({
    id: 'mercury-layer',
    type: 'circle',
    source: 'mercury-src',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 8],
      'circle-color': '#9C27B0',
      'circle-stroke-color': '#6A0080',
      'circle-stroke-width': 1,
      'circle-opacity': 0.85
    }
  });

  // ── CHROMIUM SOURCE + LAYER ──
  map.addSource('chromium-src', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addLayer({
    id: 'chromium-layer',
    type: 'circle',
    source: 'chromium-src',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 8],
      'circle-color': '#00BCD4',
      'circle-stroke-color': '#006978',
      'circle-stroke-width': 1,
      'circle-opacity': 0.85
    }
  });

  map.on('click', 'mercury-layer', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ maxWidth: '300px' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;padding:12px;background:#1A1810;border-radius:8px;color:#E8D9B0">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#9C27B0;letter-spacing:0.06em">☿ ${p.name || 'Mercury Site'}</div>
          <div style="margin-top:6px;font-size:12px;color:#6B6248">${p.county ? p.county + ' County' : ''} ${p.state || ''}</div>
          <div style="margin-top:8px;font-size:12px;color:#E8D9B0">${p.commod1 || ''}</div>
          <div style="margin-top:6px;font-size:11px;color:#9C27B0;background:rgba(156,39,176,0.1);border-radius:4px;padding:6px">
            Mercury presence can indicate nearby gold — cinnabar and gold often deposit together in hydrothermal systems.
          </div>
          ${p.dep_id ? `<div style="margin-top:10px"><a href="https://mrdata.usgs.gov/mrds/show-mrds.php?dep_id=${p.dep_id}" target="_blank" style="font-family:'DM Mono',monospace;font-size:10px;color:#9C27B0;text-decoration:none;padding:3px 8px;border:1px solid rgba(156,39,176,0.4);border-radius:4px;">USGS Record ↗</a></div>` : ''}
        </div>`)
      .addTo(map);
  });

  map.on('click', 'chromium-layer', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ maxWidth: '300px' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;padding:12px;background:#1A1810;border-radius:8px;color:#E8D9B0">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#00BCD4;letter-spacing:0.06em">⬡ ${p.name || 'Chromium Site'}</div>
          <div style="margin-top:6px;font-size:12px;color:#6B6248">${p.county ? p.county + ' County' : ''} ${p.state || ''}</div>
          <div style="margin-top:8px;font-size:12px;color:#E8D9B0">${p.commod1 || ''}</div>
          <div style="margin-top:6px;font-size:11px;color:#00BCD4;background:rgba(0,188,212,0.1);border-radius:4px;padding:6px">
            Chromium deposits form in ultramafic rocks (serpentinite, peridotite) — the same geology that hosts gold in many Oregon and California districts.
          </div>
          ${p.dep_id ? `<div style="margin-top:10px"><a href="https://mrdata.usgs.gov/mrds/show-mrds.php?dep_id=${p.dep_id}" target="_blank" style="font-family:'DM Mono',monospace;font-size:10px;color:#00BCD4;text-decoration:none;padding:3px 8px;border:1px solid rgba(0,188,212,0.4);border-radius:4px;">USGS Record ↗</a></div>` : ''}
        </div>`)
      .addTo(map);
  });

  map.on('mouseenter', 'mercury-layer', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'mercury-layer', () => map.getCanvas().style.cursor = '');
  map.on('mouseenter', 'chromium-layer', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'chromium-layer', () => map.getCanvas().style.cursor = '');

  // ── COPPER SOURCE + LAYER (Pro tier) ──
  map.addSource('copper-src', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'copper-layer',
    type: 'circle',
    source: 'copper-src',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 8],
      'circle-color': '#E87722',
      'circle-stroke-color': '#A04A00',
      'circle-stroke-width': 1,
      'circle-opacity': 0.85
    }
  });

  // ── ANTIMONY SOURCE + LAYER (Pro tier) ──
  map.addSource('antimony-src', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'antimony-layer',
    type: 'circle',
    source: 'antimony-src',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 8],
      'circle-color': '#78909C',
      'circle-stroke-color': '#455A64',
      'circle-stroke-width': 1,
      'circle-opacity': 0.85
    }
  });

  // ── SILVER SOURCE + LAYER (Pro tier) ──
  map.addSource('silver-src', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'silver-layer',
    type: 'circle',
    source: 'silver-src',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 8],
      'circle-color': '#B0BEC5',
      'circle-stroke-color': '#78909C',
      'circle-stroke-width': 1,
      'circle-opacity': 0.85
    }
  });

  map.on('click', 'copper-layer', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ maxWidth: '300px' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;padding:12px;background:#1A1810;border-radius:8px;color:#E8D9B0">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#E87722;letter-spacing:0.06em">🟤 ${p.name || 'Copper Site'}</div>
          <div style="margin-top:6px;font-size:12px;color:#6B6248">${p.county ? p.county + ' County' : ''} ${p.state || ''}</div>
          <div style="margin-top:8px;font-size:12px;color:#E8D9B0">${p.commod1 || ''}</div>
          <div style="margin-top:6px;font-size:11px;color:#E87722;background:rgba(232,119,34,0.1);border-radius:4px;padding:6px">
            Copper and gold are common companions in porphyry and skarn deposits — high copper density can indicate gold-bearing hydrothermal systems.
          </div>
          ${p.dep_id ? `<div style="margin-top:10px"><a href="https://mrdata.usgs.gov/mrds/show-mrds.php?dep_id=${p.dep_id}" target="_blank" style="font-family:'DM Mono',monospace;font-size:10px;color:#E87722;text-decoration:none;padding:3px 8px;border:1px solid rgba(232,119,34,0.4);border-radius:4px;">USGS Record ↗</a></div>` : ''}
        </div>`)
      .addTo(map);
  });

  map.on('click', 'antimony-layer', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ maxWidth: '300px' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;padding:12px;background:#1A1810;border-radius:8px;color:#E8D9B0">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#78909C;letter-spacing:0.06em">⬡ ${p.name || 'Antimony Site'}</div>
          <div style="margin-top:6px;font-size:12px;color:#6B6248">${p.county ? p.county + ' County' : ''} ${p.state || ''}</div>
          <div style="margin-top:8px;font-size:12px;color:#E8D9B0">${p.commod1 || ''}</div>
          <div style="margin-top:6px;font-size:11px;color:#78909C;background:rgba(120,144,156,0.1);border-radius:4px;padding:6px">
            Antimony (stibnite) is a key pathfinder mineral for gold — many major gold deposits worldwide have antimony anomalies nearby.
          </div>
          ${p.dep_id ? `<div style="margin-top:10px"><a href="https://mrdata.usgs.gov/mrds/show-mrds.php?dep_id=${p.dep_id}" target="_blank" style="font-family:'DM Mono',monospace;font-size:10px;color:#78909C;text-decoration:none;padding:3px 8px;border:1px solid rgba(120,144,156,0.4);border-radius:4px;">USGS Record ↗</a></div>` : ''}
        </div>`)
      .addTo(map);
  });

  map.on('click', 'silver-layer', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ maxWidth: '300px' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;padding:12px;background:#1A1810;border-radius:8px;color:#E8D9B0">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#B0BEC5;letter-spacing:0.06em">🪙 ${p.name || 'Silver Site'}</div>
          <div style="margin-top:6px;font-size:12px;color:#6B6248">${p.county ? p.county + ' County' : ''} ${p.state || ''}</div>
          <div style="margin-top:8px;font-size:12px;color:#E8D9B0">${p.commod1 || ''}</div>
          <div style="margin-top:6px;font-size:11px;color:#B0BEC5;background:rgba(176,190,197,0.1);border-radius:4px;padding:6px">
            Silver and gold are frequently co-deposited in epithermal veins. Silver-rich areas are strong indicators of precious metal mineralization.
          </div>
          ${p.dep_id ? `<div style="margin-top:10px"><a href="https://mrdata.usgs.gov/mrds/show-mrds.php?dep_id=${p.dep_id}" target="_blank" style="font-family:'DM Mono',monospace;font-size:10px;color:#B0BEC5;text-decoration:none;padding:3px 8px;border:1px solid rgba(176,190,197,0.4);border-radius:4px;">USGS Record ↗</a></div>` : ''}
        </div>`)
      .addTo(map);
  });

  map.on('mouseenter', 'copper-layer', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'copper-layer', () => map.getCanvas().style.cursor = '');
  map.on('mouseenter', 'antimony-layer', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'antimony-layer', () => map.getCanvas().style.cursor = '');
  map.on('mouseenter', 'silver-layer', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'silver-layer', () => map.getCanvas().style.cursor = '');

  map.on('click', 'gold-occurrences-layer', (e) => {
    const p = e.features[0].properties;
    const statusColors = {
      'Producer': '#FFD700', 'Past Producer': '#F0C040',
      'Prospect': '#FF9800', 'Occurrence': '#A0A0A0'
    };
    const statusColor = statusColors[p.dev_stat] || '#C9A84C';
    const statusDescs = {
      'Producer': 'Actively mined — confirmed gold source',
      'Past Producer': 'Historically mined — known gold area',
      'Prospect': 'Gold traces found — worth investigating',
      'Occurrence': 'Geologically noted — unconfirmed'
    };
    const statusIcons = {
      'Producer': '🟡', 'Past Producer': '🟡',
      'Prospect': '🟠', 'Occurrence': '⚪'
    };

    // Translate ore minerals to prospecting significance
    const oreSignificance = (ore) => {
      if (!ore) return '';
      const terms = {
        'native gold': '✅ Native gold — best indicator',
        'gold': '✅ Gold confirmed',
        'pyrite': '⚠️ Pyrite (fool\'s gold) — often near real gold',
        'quartz': '📍 Quartz veins — lode gold indicator',
        'magnetite': '🔵 Black sand — placer indicator',
        'chalcopyrite': '🟤 Copper mineral — may carry gold',
        'arsenopyrite': '⚠️ Arsenopyrite — common gold host',
        'galena': '⚪ Galena — silver/lead, sometimes gold'
      };
      const lower = ore.toLowerCase();
      const matches = Object.entries(terms)
        .filter(([k]) => lower.includes(k))
        .map(([, v]) => v);
      return matches.length ? matches.slice(0,2).join('<br>') : ore;
    };

    new mapboxgl.Popup({ closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;background:#1A1810;border:1px solid rgba(240,192,64,0.4);border-radius:10px;padding:12px 16px;color:#E8D9B0;min-width:210px">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#F0C040;letter-spacing:0.06em">${p.name || 'Gold Site'}</div>
          <div style="margin-top:8px;background:rgba(255,255,255,0.04);border-radius:6px;padding:8px">
            <div style="font-size:12px;color:${statusColor};font-weight:500">${statusIcons[p.dev_stat] || '🥇'} ${p.dev_stat || 'Unknown'}</div>
            <div style="font-size:11px;color:#6B6248;margin-top:2px">${statusDescs[p.dev_stat] || ''}</div>
          </div>
          ${p.ore ? `<div style="margin-top:8px;font-size:11px;color:#A0A0A0;line-height:1.6">${oreSignificance(p.ore)}</div>` : ''}
          <div style="font-family:'DM Mono',monospace;font-size:10px;color:#6B6248;margin-top:8px">${p.county || ''} County · ${p.state || ''}</div>
          ${p.commod2 || p.commod3 ? `<div style="margin-top:6px;font-size:11px;color:#6B6248">Also: ${[p.commod2, p.commod3].filter(Boolean).join(', ')}</div>` : ''}
          ${['Y','S','M','L'].includes(p.prod_size) ? `<div style="margin-top:6px;font-size:11px;color:#F0C040;background:rgba(240,192,64,0.1);border-radius:4px;padding:4px 8px">⛏️ Was Worked — confirmed production history</div>` : `<div style="margin-top:6px;font-size:11px;color:#6B6248">No recorded production</div>`}
          ${p.dep_id ? `<div style="margin-top:10px"><a href="https://mrdata.usgs.gov/mrds/show-mrds.php?dep_id=${p.dep_id}" target="_blank" style="font-family:'DM Mono',monospace;font-size:10px;color:#F0C040;text-decoration:none;padding:3px 8px;border:1px solid rgba(240,192,64,0.4);border-radius:4px;">USGS Record ↗</a></div>` : ''}
        </div>
      `)
      .addTo(map);
  });

  map.on('click', 'hist-mines-layer', (e) => {
    const p = e.features[0].properties;

    const operDescs = {
      'Surface': 'Open pit or surface workings — accessible',
      'Underground': '⚠️ Underground shaft/tunnel — extremely hazardous, never enter',
      'Placer': 'Alluvial gold recovery — stream/gravel based',
      'Dredge': 'Large scale dredging — old workings indicate good area',
      'Combination': 'Mixed surface and underground operations'
    };
    const operDesc = operDescs[p.oper_type] || p.oper_type || '';
    const isUnderground = (p.oper_type || '').toLowerCase().includes('underground');

    new mapboxgl.Popup({ closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;background:#1A1810;border:1px solid rgba(255,111,0,0.4);border-radius:10px;padding:12px 16px;color:#E8D9B0;min-width:210px">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#FF6F00;letter-spacing:0.06em">🕳️ ${p.name || 'Mine Site'}</div>
          ${isUnderground ? `<div style="margin-top:8px;background:rgba(244,67,54,0.12);border:1px solid rgba(244,67,54,0.4);border-radius:6px;padding:6px 10px;font-size:11px;color:#F44336">⚠️ Underground mine — Do not enter. Risk of collapse, gas, flooding.</div>` : ''}
          <div style="margin-top:8px;background:rgba(255,255,255,0.04);border-radius:6px;padding:8px">
            <div style="font-size:12px;color:#FF9800">${p.oper_type || 'Mine Site'}</div>
            <div style="font-size:11px;color:#6B6248;margin-top:2px">${operDesc}</div>
          </div>
          <div style="margin-top:8px;font-size:12px;color:#E8D9B0">${p.commod1 || ''}</div>
          <div style="font-family:'DM Mono',monospace;font-size:10px;color:#6B6248;margin-top:4px">${p.county || ''} County · ${p.state || ''}</div>
          ${p.dep_id ? `<div style="margin-top:10px"><a href="https://mrdata.usgs.gov/mrds/show-mrds.php?dep_id=${p.dep_id}" target="_blank" style="font-family:'DM Mono',monospace;font-size:10px;color:#FF9800;text-decoration:none;padding:3px 8px;border:1px solid rgba(255,111,0,0.4);border-radius:4px;">USGS Record ↗</a></div>` : ''}
        </div>
      `)
      .addTo(map);
  });

  map.on('mouseenter', 'gold-occurrences-layer', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'gold-occurrences-layer', () => map.getCanvas().style.cursor = '');
  map.on('mouseenter', 'hist-mines-layer', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'hist-mines-layer', () => map.getCanvas().style.cursor = '');

  map.on('mouseenter', 'active-claims-fill', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'active-claims-fill', () => map.getCanvas().style.cursor = '');
  ['closed-claims-fill-1','closed-claims-fill-2','closed-claims-fill-3','closed-claims-fill-4','closed-claims-fill-5'].forEach(l => {
    map.on('mouseenter', l, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', l, () => map.getCanvas().style.cursor = '');
  });

  // ── QUATERNARY FAULTS (vector tileset — gold-bearing structures) ──
  map.addSource('quaternary-faults-src', {
    type: 'vector',
    url: 'mapbox://dpapp12.a0sxxkvb'
  });

  map.addLayer({
    id: 'quaternary-faults-layer',
    type: 'line',
    source: 'quaternary-faults-src',
    'source-layer': 'quaternary_faults-5jqptj',
    layout: { visibility: 'none' },
    paint: {
      'line-color': '#E91E63',
      'line-width': 1.6,
      'line-opacity': 0.85
    }
  });

  map.on('click', 'quaternary-faults-layer', (e) => {
    const p = e.features[0].properties || {};
    const name = p.name || p.NAME || p.fault_name || p.sec_name || p.section_na || 'Unnamed Fault';
    const age = p.age || p.age_young || p.q_age || p.AGE || '';
    const slipSense = p.slip_sens || p.slip_sense || p.SLIP_SENSE || p.sense || '';
    const slipRate = p.slip_rate || p.SLIP_RATE || p.rate || '';
    const length = p.length_km || p.LENGTH_KM || p.len_km || '';
    const state = p.state || p.STATE || '';

    const ageMap = {
      'Historic': 'Historic (< 150 years ago)',
      'Latest Quaternary': 'Latest Quaternary (< 15,000 years)',
      'Late Quaternary': 'Late Quaternary (< 130,000 years)',
      'Middle and Late Quaternary': 'Middle–Late Quaternary (< 750,000 years)',
      'Quaternary': 'Quaternary (< 2.6 million years)'
    };
    const ageDesc = ageMap[age] || age || '';

    new mapboxgl.Popup({ closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;background:#1A1810;border:1px solid rgba(233,30,99,0.4);border-radius:10px;padding:12px 16px;color:#E8D9B0;min-width:220px">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#E91E63;letter-spacing:0.06em">〰 ${name}</div>
          <div style="margin-top:8px;background:rgba(233,30,99,0.08);border:1px solid rgba(233,30,99,0.25);border-radius:6px;padding:8px">
            <div style="font-size:11px;color:#E8D9B0">Fractures in bedrock act as conduits for hydrothermal fluids carrying gold. Prospect <em>near</em> the trace, not on it.</div>
          </div>
          ${ageDesc ? `<div style="margin-top:8px;font-size:12px;color:#E8D9B0"><span style="color:#E91E63">Age:</span> ${ageDesc}</div>` : ''}
          ${slipSense ? `<div style="margin-top:4px;font-size:12px;color:#E8D9B0"><span style="color:#E91E63">Slip:</span> ${slipSense}</div>` : ''}
          ${slipRate ? `<div style="margin-top:4px;font-size:12px;color:#E8D9B0"><span style="color:#E91E63">Rate:</span> ${slipRate}</div>` : ''}
          ${length ? `<div style="margin-top:4px;font-size:12px;color:#E8D9B0"><span style="color:#E91E63">Length:</span> ${length} km</div>` : ''}
          <div style="font-family:'DM Mono',monospace;font-size:10px;color:#6B6248;margin-top:8px">USGS Quaternary Faults${state ? ` · ${state}` : ''}</div>
        </div>
      `)
      .addTo(map);
  });

  map.on('mouseenter', 'quaternary-faults-layer', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'quaternary-faults-layer', () => map.getCanvas().style.cursor = '');

  // ── BLM SURFACE MANAGEMENT (vector boundaries only) ──
  map.addSource('blm-surface-src', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addLayer({
    id: 'blm-surface-fill',
    type: 'fill',
    source: 'blm-surface-src',
    layout: { visibility: 'none' },
    paint: {
      'fill-color': [
        'match', ['get', 'adm_code'],
        'BLM', '#FF9800',
        'USFS', '#4CAF50',
        'NPS', '#9C27B0',
        'FWS', '#2196F3',
        '#888888'
      ],
      'fill-opacity': 0.12
    }
  }, 'active-claims-fill');

  map.addLayer({
    id: 'blm-surface-layer',
    type: 'line',
    source: 'blm-surface-src',
    layout: { visibility: 'none' },
    paint: {
      'line-color': [
        'match', ['get', 'adm_code'],
        'BLM', '#FF9800',
        'USFS', '#4CAF50',
        'NPS', '#9C27B0',
        'FWS', '#2196F3',
        '#888888'
      ],
      'line-width': 1.5,
      'line-opacity': 0.7
    }
  }, 'active-claims-fill');

  // ── RESTRICTED LANDS ──
  // National Parks
  map.addSource('natl-parks-src', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'natl-parks-fill',
    type: 'fill',
    source: 'natl-parks-src',
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#F44336', 'fill-opacity': 0.2 }
  }, 'active-claims-fill');
  map.addLayer({
    id: 'natl-parks-line',
    type: 'line',
    source: 'natl-parks-src',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#F44336', 'line-width': 1.5, 'line-opacity': 0.8 }
  }, 'active-claims-fill');

  // Wilderness Areas
  map.addSource('wilderness-src', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'wilderness-fill',
    type: 'fill',
    source: 'wilderness-src',
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#FF9800', 'fill-opacity': 0.18 }
  }, 'active-claims-fill');
  map.addLayer({
    id: 'wilderness-line',
    type: 'line',
    source: 'wilderness-src',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#FF9800', 'line-width': 1.5, 'line-opacity': 0.8 }
  }, 'active-claims-fill');

  // Popups for restricted areas
  map.on('click', 'natl-parks-fill', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;background:#1A1810;border:1px solid rgba(244,67,54,0.5);border-radius:10px;padding:12px 16px;color:#E8D9B0;min-width:200px">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#F44336;letter-spacing:0.06em">❌ ${p.UNIT_NAME || p.unit_name || 'National Park'}</div>
          <div style="margin-top:8px;background:rgba(244,67,54,0.1);border:1px solid rgba(244,67,54,0.3);border-radius:6px;padding:8px">
            <div style="font-size:12px;color:#F44336;font-weight:500">No Prospecting Allowed</div>
            <div style="font-size:11px;color:#6B6248;margin-top:3px">National Park Service land. Collecting minerals, metals, or artifacts is prohibited under federal law.</div>
          </div>
          <div style="font-family:'DM Mono',monospace;font-size:10px;color:#6B6248;margin-top:8px">${p.STATE || p.state || ''} · NPS</div>
        </div>
      `)
      .addTo(map);
  });

  map.on('click', 'wilderness-fill', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;background:#1A1810;border:1px solid rgba(255,152,0,0.5);border-radius:10px;padding:12px 16px;color:#E8D9B0;min-width:200px">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#FF9800;letter-spacing:0.06em">⚠️ ${p.NAME || p.name || 'Wilderness Area'}</div>
          <div style="margin-top:8px;background:rgba(255,152,0,0.1);border:1px solid rgba(255,152,0,0.3);border-radius:6px;padding:8px">
            <div style="font-size:12px;color:#FF9800;font-weight:500">Restricted — No Mechanized Equipment</div>
            <div style="font-size:11px;color:#6B6248;margin-top:3px">Wilderness Act prohibits motorized equipment and new mining claims. Hand panning may be allowed — verify with local ranger district.</div>
          </div>
          <div style="font-family:'DM Mono',monospace;font-size:10px;color:#6B6248;margin-top:8px">${p.STATE || p.state || ''} · Wilderness Act</div>
        </div>
      `)
      .addTo(map);
  });

  map.on('mouseenter', 'natl-parks-fill', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'natl-parks-fill', () => map.getCanvas().style.cursor = '');
  map.on('mouseenter', 'wilderness-fill', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'wilderness-fill', () => map.getCanvas().style.cursor = '');

  // ── OPEN TO CLAIM (BLM land only) ──
  map.addSource('open-to-claim-src', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addLayer({
    id: 'open-to-claim-fill',
    type: 'fill',
    source: 'open-to-claim-src',
    layout: { visibility: 'none' },
    paint: {
      'fill-color': '#4CAF50',
      'fill-opacity': 0.15
    }
  }, 'active-claims-fill');

  map.addLayer({
    id: 'open-to-claim-line',
    type: 'line',
    source: 'open-to-claim-src',
    layout: { visibility: 'none' },
    paint: {
      'line-color': '#4CAF50',
      'line-width': 1.5,
      'line-dasharray': [3, 2],
      'line-opacity': 0.8
    }
  }, 'active-claims-fill');

  map.on('click', 'open-to-claim-fill', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:'DM Sans',sans-serif;background:#1A1810;border:1px solid rgba(76,175,80,0.5);border-radius:10px;padding:12px 16px;color:#E8D9B0;min-width:200px">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#4CAF50;letter-spacing:0.06em">✅ Open BLM Land</div>
          <div style="margin-top:8px;background:rgba(76,175,80,0.1);border:1px solid rgba(76,175,80,0.3);border-radius:6px;padding:8px">
            <div style="font-size:12px;color:#4CAF50;font-weight:500">Available to Prospect & Claim</div>
            <div style="font-size:11px;color:#6B6248;margin-top:3px">This area appears to be open BLM land. You may be able to prospect and file a claim under the 1872 Mining Law.</div>
          </div>
          <div style="margin-top:8px;background:rgba(255,152,0,0.08);border:1px solid rgba(255,152,0,0.3);border-radius:6px;padding:8px">
            <div style="font-size:11px;color:#FF9800">⚠️ Always verify before staking</div>
            <div style="font-size:11px;color:#6B6248;margin-top:2px">Withdrawals, monuments, and special management areas may apply. Confirm with your local BLM field office.</div>
          </div>
          <div style="font-family:'DM Mono',monospace;font-size:10px;color:#6B6248;margin-top:8px">Bureau of Land Management</div>
          <div style="margin-top:10px"><a href="https://www.blm.gov/programs/energy-and-minerals/mining-and-minerals/locatable-minerals/mining-claims" target="_blank" style="font-family:'DM Mono',monospace;font-size:10px;color:#4CAF50;text-decoration:none;padding:3px 8px;border:1px solid rgba(76,175,80,0.4);border-radius:4px;">BLM Mining Info ↗</a></div>
        </div>
      `)
      .addTo(map);
  });

  map.on('mouseenter', 'open-to-claim-fill', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'open-to-claim-fill', () => map.getCanvas().style.cursor = '');

  // ── NATIONAL MONUMENTS ──
  map.addSource('monuments-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'monuments-fill', type: 'fill', source: 'monuments-src', layout: { visibility: 'none' },
    paint: { 'fill-color': '#9C27B0', 'fill-opacity': 0.18 } }, 'active-claims-fill');
  map.addLayer({ id: 'monuments-line', type: 'line', source: 'monuments-src', layout: { visibility: 'none' },
    paint: { 'line-color': '#9C27B0', 'line-width': 1.5, 'line-opacity': 0.8 } }, 'active-claims-fill');

  map.on('click', 'monuments-fill', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(`
      <div style="font-family:'DM Sans',sans-serif;background:#1A1810;border:1px solid rgba(156,39,176,0.5);border-radius:10px;padding:12px 16px;color:#E8D9B0;min-width:200px">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#9C27B0;letter-spacing:0.06em">🏛️ ${p.NAME || p.name || 'National Monument'}</div>
        <div style="margin-top:8px;background:rgba(156,39,176,0.1);border:1px solid rgba(156,39,176,0.3);border-radius:6px;padding:8px">
          <div style="font-size:12px;color:#CE93D8;font-weight:500">New Claims Prohibited</div>
          <div style="font-size:11px;color:#6B6248;margin-top:3px">National Monuments generally prohibit new mining claims. Existing valid claims may continue. Verify with managing agency.</div>
        </div>
      </div>`).addTo(map);
  });

  // ── WILD & SCENIC RIVERS ──
  map.addSource('wsr-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'wsr-layer', type: 'line', source: 'wsr-src', layout: { visibility: 'none' },
    paint: { 'line-color': '#00BCD4', 'line-width': 3, 'line-opacity': 0.8 } });

  map.on('click', 'wsr-layer', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(`
      <div style="font-family:'DM Sans',sans-serif;background:#1A1810;border:1px solid rgba(0,188,212,0.5);border-radius:10px;padding:12px 16px;color:#E8D9B0;min-width:200px">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#00BCD4;letter-spacing:0.06em">🌊 ${p.NAME || p.name || 'Wild & Scenic River'}</div>
        <div style="margin-top:8px;background:rgba(0,188,212,0.1);border:1px solid rgba(0,188,212,0.3);border-radius:6px;padding:8px">
          <div style="font-size:12px;color:#00BCD4;font-weight:500">Restricted Corridor</div>
          <div style="font-size:11px;color:#6B6248;margin-top:3px">Wild & Scenic River corridors restrict new mining claims and motorized dredging. Hand panning may be allowed — verify with local ranger district.</div>
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:10px;color:#6B6248;margin-top:8px">${p.RIVERNAME || p.river_name || ''}</div>
      </div>`).addTo(map);
  });

  // ── TRIBAL LANDS ──
  map.addSource('tribal-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'tribal-fill', type: 'fill', source: 'tribal-src', layout: { visibility: 'none' },
    paint: { 'fill-color': '#795548', 'fill-opacity': 0.2 } }, 'active-claims-fill');
  map.addLayer({ id: 'tribal-line', type: 'line', source: 'tribal-src', layout: { visibility: 'none' },
    paint: { 'line-color': '#795548', 'line-width': 1.5, 'line-opacity': 0.8 } }, 'active-claims-fill');

  map.on('click', 'tribal-fill', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(`
      <div style="font-family:'DM Sans',sans-serif;background:#1A1810;border:1px solid rgba(121,85,72,0.5);border-radius:10px;padding:12px 16px;color:#E8D9B0;min-width:200px">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#A1887F;letter-spacing:0.06em">🏔️ ${p.AIANNHCE || p.NAME || p.name || 'Tribal Land'}</div>
        <div style="margin-top:8px;background:rgba(121,85,72,0.1);border:1px solid rgba(121,85,72,0.3);border-radius:6px;padding:8px">
          <div style="font-size:12px;color:#A1887F;font-weight:500">Tribal Sovereign Land — No Access</div>
          <div style="font-size:11px;color:#6B6248;margin-top:3px">Federally recognized tribal land. Prospecting, detecting, and artifact collecting require tribal permission. Federal laws protecting tribal sovereignty apply.</div>
        </div>
      </div>`).addTo(map);
  });

  map.on('mouseenter', 'monuments-fill', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'monuments-fill', () => map.getCanvas().style.cursor = '');
  map.on('mouseenter', 'wsr-layer', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'wsr-layer', () => map.getCanvas().style.cursor = '');
  map.on('mouseenter', 'tribal-fill', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'tribal-fill', () => map.getCanvas().style.cursor = '');

  // fetchBLMBoundaries defined globally below

  // ── USGS 3DEP HILLSHADE — 11 styles via renderingRule ──
  // All styles route through hillshade-proxy.dpapp12.workers.dev,
  // which forwards to elevation.nationalmap.gov/.../exportImage and
  // caches at Cloudflare edge 24h. First user per tile pays USGS
  // render latency (~2s), rest get ~50ms. All 10 layers inserted
  // below active-claims-fill so claim polygons stay legible.
  // Custom Hillshade is registered separately below.
  registerLidarLayers();

  // Standalone Custom Hillshade — independent of the layer picker.
  // Source/layer registered once, visibility toggled via its own switch.
  registerCustomHillshadeLayer();

  // ── HILLSHADE OCEAN/WATER MASK ──
  // Paints water polygons opaque blue OVER the hillshade so ocean/lakes
  // don't render as flat gray hillshade noise. Only visible when LiDAR is on.
  if (!map.getSource('mapbox-streets-src')) {
    map.addSource('mapbox-streets-src', {
      type: 'vector',
      url: 'mapbox://mapbox.mapbox-streets-v8'
    });
  }
  map.addLayer({
    id: 'hillshade-water-mask',
    type: 'fill',
    source: 'mapbox-streets-src',
    'source-layer': 'water',
    layout: { visibility: (activeLidarStyles.size > 0) ? 'visible' : 'none' },
    paint: {
      'fill-color': '#7BA5C4',
      'fill-opacity': 1.0
    }
  }, 'active-claims-fill');

  // Contour lines - vector from Mapbox terrain
  map.addSource('contours-src', {
    type: 'vector',
    url: 'mapbox://mapbox.mapbox-terrain-v2'
  });

  map.addLayer({
    id: 'topo-layer',
    type: 'line',
    source: 'contours-src',
    'source-layer': 'contour',
    layout: { visibility: 'none' },
    paint: {
      'line-color': [
        'interpolate', ['linear'], ['get', 'ele'],
        0, '#8B7355',
        500, '#A0896B',
        1000, '#B09070',
        2000, '#C4A882'
      ],
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, ['case', ['==', ['%', ['get', 'ele'], 500], 0], 1.5, 0.5],
        14, ['case', ['==', ['%', ['get', 'ele'], 500], 0], 2.5, 1]
      ],
      'line-opacity': 0.6
    }
  }, 'active-claims-fill');

  // Contour labels at higher zoom
  map.addLayer({
    id: 'topo-labels',
    type: 'symbol',
    source: 'contours-src',
    'source-layer': 'contour',
    layout: {
      visibility: 'none',
      'symbol-placement': 'line',
      'text-field': ['concat', ['to-string', ['get', 'ele']], 'm'],
      'text-font': ['DIN Offc Pro Regular', 'Arial Unicode MS Regular'],
      'text-size': 10,
      'text-max-angle': 30
    },
    filter: ['==', ['%', ['get', 'ele'], 500], 0],
    paint: {
      'text-color': '#C4A882',
      'text-halo-color': 'rgba(0,0,0,0.6)',
      'text-halo-width': 1
    }
  }, 'active-claims-fill');

  // ── ACTIVE CLAIMS BY TYPE (filter on existing tileset) ──
  const claimTypes = [
    { id: 'placer', filter: 'PLACER CLAIM', color: '#64B5F6' },
    { id: 'lode',   filter: 'LODE CLAIM',   color: '#A5D6A7' },
    { id: 'tunnel', filter: 'TUNNEL SITE',  color: '#CE93D8' },
    { id: 'mill',   filter: 'MILL SITE',    color: '#FFCC80' }
  ];

  claimTypes.forEach(({ id, filter, color }) => {
    map.addLayer({
      id: `${id}-claims-fill`,
      type: 'fill',
      source: 'active-claims-src',
      'source-layer': 'active_claims_final-0xk0t5',
      filter: ['==', ['upcase', ['coalesce', ['get', 'BLM_PROD'], '']], filter],
      layout: { visibility: 'none' },
      paint: { 'fill-color': color, 'fill-opacity': 0.35 }
    });
    map.addLayer({
      id: `${id}-claims-line`,
      type: 'line',
      source: 'active-claims-src',
      'source-layer': 'active_claims_final-0xk0t5',
      filter: ['==', ['upcase', ['coalesce', ['get', 'BLM_PROD'], '']], filter],
      layout: { visibility: 'none' },
      paint: { 'line-color': color, 'line-width': 1.5, 'line-opacity': 0.9 }
    });
  });

  // ── PLSS SURVEY GRID (loaded on demand) ──
  map.addSource('plss-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'plss-layer',
    type: 'line',
    source: 'plss-src',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#FFF59D', 'line-width': 0.8, 'line-opacity': 0.7, 'line-dasharray': [4, 2] }
  });

  // ── BLM ROADS & TRAILS (loaded on demand) ──
  map.addSource('blm-roads-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'blm-roads-layer',
    type: 'line',
    source: 'blm-roads-src',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#FFAB40', 'line-width': 1.5, 'line-opacity': 0.8 }
  });

  map.on('click', 'blm-roads-layer', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(`
      <div style="font-family:'DM Sans',sans-serif;background:#1A1810;border:1px solid rgba(255,171,64,0.5);border-radius:10px;padding:12px 16px;color:#E8D9B0;min-width:180px">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#FFAB40;letter-spacing:0.06em">🛤 ${p.ROUTE_NAME || p.name || 'BLM Road'}</div>
        <div style="font-size:12px;color:#6B6248;margin-top:6px">${p.SURFACE_TYPE || p.ROAD_TYPE || ''}</div>
      </div>`).addTo(map);
  });
  map.on('mouseenter', 'blm-roads-layer', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'blm-roads-layer', () => map.getCanvas().style.cursor = '');

  // ── MILITARY AREAS (loaded on demand) ──
  map.addSource('military-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'military-fill', type: 'fill', source: 'military-src', layout: { visibility: 'none' },
    paint: { 'fill-color': '#F44336', 'fill-opacity': 0.15 } }, 'active-claims-fill');
  map.addLayer({ id: 'military-line', type: 'line', source: 'military-src', layout: { visibility: 'none' },
    paint: { 'line-color': '#F44336', 'line-width': 1.5, 'line-dasharray': [6, 2], 'line-opacity': 0.8 } }, 'active-claims-fill');

  map.on('click', 'military-fill', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(`
      <div style="font-family:'DM Sans',sans-serif;background:#1A1810;border:1px solid rgba(244,67,54,0.5);border-radius:10px;padding:12px 16px;color:#E8D9B0;min-width:200px">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#F44336;letter-spacing:0.06em">⚠️ ${p.Mng_Name || p.Unit_Nm || p.name || 'Military Area'}</div>
        <div style="margin-top:8px;background:rgba(244,67,54,0.1);border:1px solid rgba(244,67,54,0.3);border-radius:6px;padding:8px">
          <div style="font-size:12px;color:#F44336;font-weight:500">No Public Access</div>
          <div style="font-size:11px;color:#6B6248;margin-top:3px">Military installation. No prospecting, detecting, or unauthorized entry. Federal law enforced.</div>
        </div>
      </div>`).addTo(map);
  });
  map.on('mouseenter', 'military-fill', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'military-fill', () => map.getCanvas().style.cursor = '');
}

function toggleLayer(id) {
  layerState[id] = !layerState[id];

  // Update bullet + name visual state
  const bullet = document.getElementById(`bullet-${id}`);
  const name = document.getElementById(`name-${id}`);
  if (bullet) bullet.classList.toggle('on', layerState[id]);
  if (name) name.classList.toggle('on', layerState[id]);

  // Also update hidden toggle for compat
  const toggle = document.getElementById(`toggle-${id}`);
  if (toggle) toggle.classList.toggle('on', layerState[id]);

  if (!map) return;

  const mapLayerMap = {
    'active-claims':  ['active-claims-fill', 'active-claims-line'],
    'placer-claims':  ['placer-claims-fill', 'placer-claims-line'],
    'lode-claims':    ['lode-claims-fill', 'lode-claims-line'],
    'tunnel-claims':  ['tunnel-claims-fill', 'tunnel-claims-line'],
    'mill-claims':    ['mill-claims-fill', 'mill-claims-line'],
    'closed-claims':  ['closed-claims-fill-1','closed-claims-line-1','closed-claims-fill-2','closed-claims-line-2','closed-claims-fill-3','closed-claims-line-3','closed-claims-fill-4','closed-claims-line-4','closed-claims-fill-5','closed-claims-line-5'],
    'open-land':      ['blm-surface-fill', 'blm-surface-layer'],
    'open-to-claim':  ['open-to-claim-fill', 'open-to-claim-line'],
    'plss':           'plss-layer',
    'blm-roads':      'blm-roads-layer',
    'contours':       ['topo-layer', 'topo-labels'],
    'hist-mines':     'hist-mines-layer',
    'gold-occurrences': 'gold-occurrences-layer',
    'mercury':        'mercury-layer',
    'chromium':       'chromium-layer',
    'copper':         'copper-layer',
    'antimony':       'antimony-layer',
    'silver':         'silver-layer',
    'quaternary-faults': 'quaternary-faults-layer',
    'stream-gauges':  'stream-gauges-layer',
    'natl-parks':     ['natl-parks-fill', 'natl-parks-line'],
    'wilderness':     ['wilderness-fill', 'wilderness-line'],
    'monuments':      ['monuments-fill', 'monuments-line'],
    'wild-scenic':    'wsr-layer',
    'tribal':         ['tribal-fill', 'tribal-line'],
    'military':       ['military-fill', 'military-line'],
    'terrain-3d':     null,
    'placer-heatmap': 'gold-heatmap-layer',
    'lode-heatmap':   'mines-heatmap-layer',
    'placer-density': null
  };

  if (id === 'terrain-3d') {
    map.setTerrain(layerState[id] ? { source: 'mapbox-dem', exaggeration: 1.6 } : null);
    return;
  }

  // Coming soon stub (placer-density only — heatmaps are now live)
  if (id === 'placer-density') {
    showStatus('Coming soon — Pro feature');
    layerState[id] = false;
    if (bullet) bullet.classList.remove('on');
    if (name) name.classList.remove('on');
    updateActiveLayerBar();
    return;
  }

  // Heatmap layers — auto-load underlying point data if not yet fetched
  if (id === 'placer-heatmap') {
    if (layerState[id] && !goldLoaded) fetchGoldOccurrences();
    const htgt = mapLayerMap[id];
    if (htgt && map.getLayer(htgt)) map.setLayoutProperty(htgt, 'visibility', layerState[id] ? 'visible' : 'none');
    updateActiveLayerBar();
    return;
  }
  if (id === 'lode-heatmap') {
    if (layerState[id] && !minesLoaded) fetchHistoricMines();
    const htgt = mapLayerMap[id];
    if (htgt && map.getLayer(htgt)) map.setLayoutProperty(htgt, 'visibility', layerState[id] ? 'visible' : 'none');
    updateActiveLayerBar();
    return;
  }

  // Fetch on first toggle
  if (id === 'gold-occurrences' && layerState[id]) fetchGoldOccurrences();
  if (id === 'hist-mines' && layerState[id]) fetchHistoricMines();
  if (id === 'mercury' && layerState[id]) fetchMercury();
  if (id === 'chromium' && layerState[id]) fetchChromium();
  if (id === 'copper' && layerState[id]) {
    if (!checkProStatus()) {
      showStatus('🔒 Copper layer is a Pro feature');
      layerState[id] = false;
      if (bullet) bullet.classList.remove('on');
      if (name) name.classList.remove('on');
      updateActiveLayerBar();
      return;
    }
    fetchCopper();
  }
  if (id === 'antimony' && layerState[id]) {
    if (!checkProStatus()) {
      showStatus('🔒 Antimony layer is a Pro feature');
      layerState[id] = false;
      if (bullet) bullet.classList.remove('on');
      if (name) name.classList.remove('on');
      updateActiveLayerBar();
      return;
    }
    fetchAntimony();
  }
  if (id === 'silver' && layerState[id]) {
    if (!checkProStatus()) {
      showStatus('🔒 Silver layer is a Pro feature');
      layerState[id] = false;
      if (bullet) bullet.classList.remove('on');
      if (name) name.classList.remove('on');
      updateActiveLayerBar();
      return;
    }
    fetchSilver();
  }
  if (id === 'open-land' && layerState[id]) fetchBLMBoundaries();
  if (id === 'natl-parks' && layerState[id]) fetchNationalParks();
  if (id === 'wilderness' && layerState[id]) fetchWilderness();
  if (id === 'open-to-claim' && layerState[id]) fetchOpenToClaim();
  if (id === 'monuments' && layerState[id]) fetchMonuments();
  if (id === 'wild-scenic' && layerState[id]) fetchWildScenic();
  if (id === 'tribal' && layerState[id]) fetchTribalLands();
  if (id === 'military' && layerState[id]) fetchMilitaryAreas();
  if (id === 'plss' && layerState[id]) fetchPLSS();
  if (id === 'blm-roads' && layerState[id]) fetchBLMRoads();
  updateRestrictionLegend();

  const target = mapLayerMap[id];
  if (!target) { updateActiveLayerBar(); return; }

  const layers = Array.isArray(target) ? target : [target];
  const vis = layerState[id] ? 'visible' : 'none';
  layers.forEach(l => {
    if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', vis);
  });
  updateActiveLayerBar();
}

function toggleLayers() {
  layerPanelOpen = !layerPanelOpen;
  document.getElementById('layer-panel').classList.toggle('open', layerPanelOpen);
  document.getElementById('overlay').classList.toggle('show', layerPanelOpen);
  document.getElementById('layer-btn').classList.toggle('active', layerPanelOpen);
  if (styleSwitcherOpen) toggleStyles();
}

function toggleGroup(id) {
  const group = document.getElementById(`group-${id}`);
  const body = document.getElementById(`body-${id}`);
  const arrow = document.getElementById(`arrow-${id}`);
  const isCollapsed = group.classList.contains('is-collapsed');
  if (isCollapsed) {
    group.classList.remove('is-collapsed');
    body.classList.remove('collapsed');
    if (arrow) arrow.style.transform = '';
  } else {
    group.classList.add('is-collapsed');
    body.classList.add('collapsed');
    if (arrow) arrow.style.transform = 'rotate(180deg)';
  }
}


// ── ACTIVE LAYER INDICATOR BAR ──────────────────────────
const LAYER_CHIP_LABELS = {
  'placer-claims':   '⬡ Placer',
  'lode-claims':     '⬡ Lode',
  'tunnel-claims':   '⬡ Tunnel',
  'mill-claims':     '⬡ Mill',
  'closed-claims':   '● Closed Claims',
  'gold-occurrences':'🥇 Gold Sites',
  'hist-mines':      '🕳 Mine Sites',
  'placer-heatmap':  '🔥 Gold Heat',
  'lode-heatmap':    '🔥 Mine Heat',
  'mercury':         '☿ Mercury',
  'chromium':        '⬡ Chromium',
  'copper':          '🟤 Copper',
  'antimony':        '⬡ Antimony',
  'silver':          '🪙 Silver',
  'quaternary-faults':'〰 Faults',
  'stream-gauges':   '💧 Gauges',
  'open-land':       '🟠 Land Mgmt',
  'open-to-claim':   '✅ Open BLM',
  'plss':            '📐 Survey Grid',
  'blm-roads':       '🛤 BLM Roads',
  'natl-parks':      '❌ Natl Parks',
  'wilderness':      '⚠️ Wilderness',
  'monuments':       '🏛 Monuments',
  'wild-scenic':     '🌊 Wild Scenic',
  'tribal':          '🏔 Tribal',
  'military':        '⚠️ Military',
  'contours':        '📈 Contours',
  'terrain-3d':      '⛰ 3D Terrain',
};

function updateActiveLayerBar() {
  const bar   = document.getElementById('active-layer-bar');
  const chips = document.getElementById('active-layer-chips');
  if (!bar || !chips) return;

  // active-claims is always on — don't clutter the bar with it
  const activeIds = Object.entries(layerState)
    .filter(([id, on]) => on && id !== 'active-claims')
    .map(([id]) => id);

  const lidarCount = (typeof activeLidarStyles !== 'undefined') ? activeLidarStyles.size : 0;

  if (activeIds.length === 0 && lidarCount === 0) {
    bar.classList.remove('visible');
    return;
  }

  const chipHtml = activeIds
    .filter(id => LAYER_CHIP_LABELS[id])
    .map(id => `
      <div class="layer-chip" onclick="toggleLayer('${id}')">
        ${LAYER_CHIP_LABELS[id]}<span class="chip-x">✕</span>
      </div>`)
    .join('');

  // LiDAR gets one combined chip — focused style when N=1, count when N>1.
  // Click opens the layer panel so user can customize (at-least-one-on rule
  // means we don't offer an X to kill it from the chip bar).
  let lidarChipHtml = '';
  if (lidarCount > 0) {
    const focusedStyle = LIDAR_STYLES.find(s => s.id === focusedLidarId);
    const focusedLabel = focusedStyle ? focusedStyle.label : 'LiDAR Hillshade';
    const chipLabel = (lidarCount === 1)
      ? `🗻 ${focusedLabel}`
      : `🗻 LiDAR Hillshade (${lidarCount})`;
    lidarChipHtml = `
      <div class="layer-chip" onclick="toggleLayers()">
        ${chipLabel}
      </div>`;
  }

  chips.innerHTML = chipHtml + lidarChipHtml;
  bar.classList.add('visible');
}

// ── LAYER INFO TOOLTIPS ──────────────────────────────────
const LAYER_DESCRIPTIONS = {
  'active-claims':    'All BLM mining claims currently active in this region. Green outlines on the map.',
  'placer-claims':    'Active placer claims only — gold in stream gravels. Best for panning and detecting.',
  'lode-claims':      'Active lode claims only — hardrock gold in quartz veins. Requires drilling or blasting.',
  'tunnel-claims':    'Active tunnel site claims — access tunnels to underground workings.',
  'mill-claims':      'Active mill site claims — land used for ore processing, not actual mining.',
  'closed-claims':    'Historical claims that have lapsed or been abandoned. Strong indicator of past gold finds.',
  'placer-heatmap':   'Heat map showing density of historic placer gold claims. Red = historically active area.',
  'lode-heatmap':     'Heat map showing density of historic lode gold claims. Great for finding hardrock targets.',
  'placer-density':   'Density of all historical claims combined. Red zones had the most mining activity.',
  'gold-occurrences': 'USGS recorded gold sites. Filled dot = confirmed production history. Hollow ring = no recorded production. Yellow = active producer, orange = prospect, grey = occurrence.',
  'hist-mines':       'USGS recorded mine sites. Orange dot = surface workings. Never enter underground mines — collapse risk.',
  'mercury':          'USGS recorded mercury sites. Mercury and gold often deposit together in hydrothermal systems — mercury presence nearby is a prospecting indicator.',
  'chromium':         'USGS recorded chromium sites. Chromium forms in ultramafic rocks (serpentinite) that host gold in Oregon and California districts. Strong indicator of gold-bearing geology.',
  'copper':           'USGS recorded copper sites. Copper and gold are common companions in porphyry and skarn deposits — high copper density can indicate gold-bearing hydrothermal systems. Pro tier.',
  'antimony':         'USGS recorded antimony sites. Antimony (stibnite) is a key pathfinder mineral for gold — many major gold deposits worldwide have antimony anomalies nearby. Pro tier.',
  'silver':           'USGS recorded silver sites. Silver and gold are frequently co-deposited in epithermal veins. Silver-rich areas are strong indicators of precious metal mineralization. Pro tier.',
  'quaternary-faults':'USGS Quaternary faults — bedrock fractures that have moved in the last 2.6 million years. Faults are natural conduits for hydrothermal fluids that carry gold up from depth, so they frequently mark the edges of gold-bearing districts. Prospect <em>near</em> the fault trace, not directly on it — look for crushed rock, quartz veining, and iron staining within a quarter mile of the line.',
  'open-land':        'Federal land surface management — BLM, USFS, NPS, FWS shown by agency.',
  'open-to-claim':    'BLM land currently open for mineral entry under the 1872 Mining Law. Always verify locally.',
  'plss':             'Public Land Survey System grid — the township/range grid used to describe claim locations.',
  'blm-roads':        'BLM maintained roads and trails. Shows access routes into backcountry mining areas.',
  'natl-parks':       'No prospecting of any kind permitted under federal law.',
  'wilderness':       'No motorized equipment. Hand panning may be allowed — verify with local ranger district.',
  'monuments':        'New mining claims prohibited. Existing valid claims may continue.',
  'wild-scenic':      'Motorized dredging restricted. Hand panning may be allowed — check with ranger district.',
  'tribal':           'Sovereign tribal land. No access without tribal permission. Federal law applies.',
  'military':         'Military installation. No prospecting, detecting, or unauthorized entry.',
  'stream-gauges':    'Live USGS water flow data. Green = low water ideal for panning. Red = flood conditions, stay out.',
  'terrain-3d':       'Raises the map into a 3D landscape. Tilt to see valley and ridge shapes.',
  'lidar':            'Shaded relief from elevation data. Reveals old workings and terrain features hidden under tree cover.',
  'lidar-hillshade-gray':    'Classic single-angle shaded relief. The industry-standard hillshade — best balance of detail and clarity for most terrain.',
  'lidar-hillshade-multi':   'Lit from four sun angles combined. Reveals subtle features from multiple directions — good for ridges and ravines.',
  'lidar-hillshade-tinted':  'Hillshade blended with elevation colors (green low, brown high). Shows terrain relief and altitude at a glance.',
  'lidar-hillshade-stretch': 'Gray hillshade with contrast stretched. Boosts faint relief in flat country — good for benches, terraces, and faded old workings.',
  'lidar-low-angle':         'Sun at 15° altitude. Long shadows exaggerate subtle relief — best for spotting old adits, cuts, and tailings piles.',
  'lidar-east-lit':          'Sun from the east. Highlights north-south features that standard hillshade tends to flatten.',
  'lidar-south-lit':         'Sun from the south. Highlights east-west features — good for reading stream terraces and cross-valley structures.',
  'lidar-slope-map':         'Colored by steepness. Red = steep cliffs, blue = flat ground. Pinpoints benches and break-in-slope locations.',
  'lidar-aspect-map':        'Colored by the compass direction slopes face. Useful for identifying consistent hillside orientations and weather exposure.',
  'lidar-contour':           'Vector elevation lines at smoothed 25-ft intervals. Overlay on any hillshade to read elevation numerically.',
  'lidar-custom':            'Build your own hillshade. Adjust sun direction, sun angle, and vertical exaggeration to reveal features others miss.',
  'contours':         'Elevation lines at regular intervals. Closer lines = steeper ground.'
};

let activeInfoBtn = null;
let tooltipTimeout = null;

function showLayerInfo(e, layerId) {
  e.stopPropagation();
  const tooltip = document.getElementById('layer-tooltip');
  const btn = e.currentTarget;
  if (activeInfoBtn === btn) { hideTooltip(); return; }
  if (activeInfoBtn) activeInfoBtn.classList.remove('active');
  activeInfoBtn = btn;
  btn.classList.add('active');
  tooltip.textContent = LAYER_DESCRIPTIONS[layerId] || '';
  tooltip.classList.add('show');
  const rect = btn.getBoundingClientRect();
  const tipH = 70;
  tooltip.style.left = Math.min(rect.left - 10, window.innerWidth - 230) + 'px';
  tooltip.style.top = ((window.innerHeight - rect.bottom < tipH + 20)
    ? rect.top - tipH - 8
    : rect.bottom + 8) + 'px';
  clearTimeout(tooltipTimeout);
  tooltipTimeout = setTimeout(hideTooltip, 4000);
}

function hideTooltip() {
  const t = document.getElementById('layer-tooltip');
  if (t) t.classList.remove('show');
  if (activeInfoBtn) activeInfoBtn.classList.remove('active');
  activeInfoBtn = null;
}

document.addEventListener('click', (e) => {
  if (activeInfoBtn && !e.target.classList.contains('info-btn')) hideTooltip();
});
