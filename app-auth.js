// ==========================================================
// app-auth.js — Unworked Gold authentication module
// Split from app.js, Session 8 commit 3 (April 19, 2026)
// Updated Session 33: Stripe checkout redirect on signup
//
// CONTENTS:
//   STATE:    SUPABASE_URL, sbClient, currentUser, authMode
//   FUNCTIONS: initSupabase, promptSupabaseKey, updateAuthUI,
//              openAuthPanel, toggleAuthMode, submitAuth,
//              signInWithGoogle, signOut,
//              redirectToCheckout, handleCheckoutReturn
//
// SHARED STATE: sbClient and currentUser are referenced by
// app.js (submitFeedback) and app-user.js (saveClaim, saveFind,
// watchClaim, account panel, spots). Both access them via
// global scope at runtime.
//
// LOAD ORDER: after app.js, before app-user.js.
// ==========================================================

// ── SUPABASE AUTH ─────────────────────────────────────────
const SUPABASE_URL = 'https://condhfwpzlxrzuadgopc.supabase.co';

// Cold-start anon key. Read from the inline config aliases set in
// index.html. Matches the same fallback pattern app.js uses for the
// Mapbox token. If both aliases are missing the field, BOOT_ANON_KEY
// resolves to null and promptSupabaseKey()'s existing
// `if (key && key.startsWith('eyJ'))` guard no-ops cleanly.
// (Defined Session 37, 2026-05-02, replacing an undefined reference
// that pre-dated the desktop UI rebuild.)
const BOOT_ANON_KEY = window.UNWORKED_GOLD_CONFIG?.supabase_anon_key
                   || window.PROSPECTOR_CONFIG?.supabase_anon_key
                   || null;

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
    updateAuthUI();
    if (typeof refreshTopbarAccount === 'function') refreshTopbarAccount();
    if (currentUser && typeof refreshProStatus === 'function') refreshProStatus();
  });
  sbClient.auth.getSession().then(({ data: { session } }) => {
    currentUser = session?.user || null;
    updateAuthUI();
    if (typeof refreshTopbarAccount === 'function') refreshTopbarAccount();
    if (currentUser && typeof refreshProStatus === 'function') refreshProStatus();
    // Handle return from Stripe checkout
    handleCheckoutReturn();
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
    if (profileLabel) profileLabel.textContent = 'Account';
    document.getElementById('user-email').textContent = currentUser.email;
    if (map) loadUserSpots();
  } else {
    if (profileLabel) profileLabel.textContent = 'Sign In';
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
  document.getElementById('auth-sub').textContent = isSignIn ? 'Access your saved claims and finds' : 'Start your 14-day free trial';
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
      if (result.error) {
        errEl.textContent = result.error.message;
        errEl.style.display = 'block';
      } else {
        closeAllPanels();
        showStatus('Welcome back!');
      }
    } else {
      // Sign up — then redirect to Stripe checkout
      result = await sbClient.auth.signUp({ email, password });
      if (result.error) {
        errEl.textContent = result.error.message;
        errEl.style.display = 'block';
      } else {
        closeAllPanels();
        showStatus('Account created! Setting up your trial...');
        // Small delay so status is visible, then redirect to checkout
        setTimeout(() => redirectToCheckout(), 1200);
      }
    }
  } catch (e) {
    errEl.textContent = 'Something went wrong. Try again.';
    errEl.style.display = 'block';
  }

  btn.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
  btn.style.opacity = '1';
}

async function redirectToCheckout(priceId) {
  // Default to monthly price; could offer choice in future
  const selectedPriceId = priceId || 'price_1TQtUOK5wRMqB1R5aTnlJgbm';

  try {
    const session = await sbClient.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) {
      showStatus('Please sign in first.');
      return;
    }

    const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ priceId: selectedPriceId })
    });

    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      showStatus('Could not start checkout. Try again.');
      console.error('Checkout error:', data);
    }
  } catch (e) {
    showStatus('Could not start checkout. Try again.');
    console.error('redirectToCheckout error:', e);
  }
}

function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  if (!checkout) return;

  // Clean URL
  const cleanUrl = window.location.pathname;
  window.history.replaceState({}, '', cleanUrl);

  if (checkout === 'success') {
    showStatus('Trial started! Explore the full map.');
  } else if (checkout === 'canceled') {
    showStatus('Checkout canceled. You can upgrade anytime from your account.');
  }
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
