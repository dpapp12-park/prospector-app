// ==========================================================
// app-ai.js — Unworked Gold AI field tools module
// Split from app.js, Session 8 commit 3 (April 19, 2026)
//
// CONTENTS:
//   Menu: toggleAIMenu, closeAIMenu (+ outside-click listener)
//   Pro gating: checkProStatus, getRockIdUses, incrementRockIdUses
//   Rock Identifier: openRockIdentifier, closeRockIdentifier,
//     resetRockId, handleRockIdUpload
//   Outcrop Mapper: openOutcropMapper, closeOutcropMapper,
//     resetOutcrop, handleOutcropUpload
//   Claude API: compressImage, analyzeWithClaude, getLocationContext
//
// USES: map, userLocation, anthropicKey, aiMenuOpen,
// FREE_ROCK_ID_LIMIT, currentUser from app.js and app-auth.js.
//
// LOAD ORDER: after app.js (uses shared state).
// ==========================================================

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

// Cached pro status — refreshed on login and periodically
// All callers stay synchronous; refreshProStatus() does the async work
let _proStatusCache = false;
let _proStatusFetchedAt = 0;
let _subscriptionRawStatus = null; // 'active' | 'trialing' | 'canceled' | 'past_due' | null
const PRO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function checkProStatus() {
  return _proStatusCache;
}

// Returns one of: 'active' | 'no_subscription' | 'expired' | 'signed_out'
function getSubscriptionState() {
  if (!currentUser) return 'signed_out';
  if (_subscriptionRawStatus === 'active' || _subscriptionRawStatus === 'trialing') return 'active';
  if (_subscriptionRawStatus === null) return 'no_subscription';
  return 'expired'; // canceled, past_due
}

async function refreshProStatus() {
  if (!currentUser || !sbClient) {
    _proStatusCache = false;
    _subscriptionRawStatus = null;
    applySubscriptionGating();
    return false;
  }
  // Skip if cache is fresh
  if (Date.now() - _proStatusFetchedAt < PRO_CACHE_TTL_MS) {
    applySubscriptionGating();
    return _proStatusCache;
  }
  try {
    const { data, error } = await sbClient
      .from('user_subscriptions')
      .select('status')
      .eq('user_id', currentUser.id)
      .single();

    if (error || !data) {
      _proStatusCache = false;
      _subscriptionRawStatus = null;
    } else {
      _subscriptionRawStatus = data.status;
      _proStatusCache = data.status === 'active' || data.status === 'trialing';
    }
    _proStatusFetchedAt = Date.now();
  } catch (e) {
    console.warn('refreshProStatus error:', e);
    _proStatusCache = false;
    _subscriptionRawStatus = null;
  }
  applySubscriptionGating();
  return _proStatusCache;
}

// Show or hide the layer panel upgrade gate based on subscription state
function applySubscriptionGating() {
  const gate = document.getElementById('layer-upgrade-gate');
  if (!gate) return;

  const state = getSubscriptionState();

  // No gate needed: not signed in (handled by beta landing), or active/trialing
  if (state === 'signed_out' || state === 'active') {
    gate.style.display = 'none';
    return;
  }

  // Update messaging based on state
  const titleEl = gate.querySelector('.lug-title');
  const subEl   = gate.querySelector('.lug-sub');
  const btnEl   = gate.querySelector('.lug-btn');

  if (state === 'no_subscription') {
    titleEl.textContent = 'Start your free trial';
    subEl.textContent   = '14 days free, then $12.99/mo. Cancel anytime.';
    btnEl.textContent   = 'Start Free Trial';
  } else {
    // expired — canceled or past_due
    titleEl.textContent = 'Your trial has ended';
    subEl.textContent   = 'Upgrade to Pro to unlock all map layers.';
    btnEl.textContent   = 'Upgrade to Pro';
  }

  gate.style.display = 'flex';
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
  var headers = { 'Content-Type': 'application/json' };
  if (typeof sbClient !== 'undefined' && sbClient) {
    var sessionData = await sbClient.auth.getSession();
    var token = sessionData?.data?.session?.access_token;
    if (token) headers['Authorization'] = 'Bearer ' + token;
  }
  var response = await fetch('/api/claude', {
    method: 'POST',
    headers: headers,
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
