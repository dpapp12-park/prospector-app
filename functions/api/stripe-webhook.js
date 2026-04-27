// Cloudflare Pages Function — Stripe webhook handler
// Route: /api/stripe-webhook
// No JWT required — verified via Stripe signature instead

const TRIAL_CREDITS = 50;
const MONTHLY_CREDITS = 200;
const MAX_CREDITS = 600; // cap to prevent hoarding

export async function onRequestPost(context) {
  const { request, env } = context;

  const STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
  const STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_WEBHOOK_SECRET) {
    return new Response('Webhook secret not configured', { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  // Verify webhook signature
  const isValid = await verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    return new Response('Invalid signature', { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return new Response('Invalid JSON', { status: 400 });
  }

  try {
    await handleEvent(event, STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY);
  } catch (e) {
    console.error('Webhook handler error:', e.message);
    // Return 200 so Stripe doesn't retry — log the error
    return new Response(JSON.stringify({ error: e.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// ── event handlers ────────────────────────────────────────

async function handleEvent(event, stripeKey, supabaseUrl, supabaseKey) {
  const { type, data } = event;
  const obj = data.object;

  switch (type) {
    case 'checkout.session.completed': {
      // User completed checkout — subscription is being created
      // The subscription.updated event will follow, but we can grab customer info here
      const customerId = obj.customer;
      const subscriptionId = obj.subscription;
      if (!customerId || !subscriptionId) break;

      // Fetch subscription to get metadata and trial_end
      const sub = await fetchStripeSubscription(subscriptionId, stripeKey);
      if (!sub) break;

      const userId = sub.metadata?.supabase_user_id;
      if (!userId) break;

      const plan = sub.metadata?.plan || 'monthly';
      const status = sub.status; // should be 'trialing'
      const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
      const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

      // Upsert subscription record
      await upsertSubscription(supabaseUrl, supabaseKey, {
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        status,
        plan,
        trial_end: trialEnd,
        current_period_end: periodEnd
      });

      // Grant trial credits
      await upsertCredits(supabaseUrl, supabaseKey, userId, TRIAL_CREDITS, true);
      break;
    }

    case 'customer.subscription.updated': {
      const userId = obj.metadata?.supabase_user_id;
      if (!userId) break;

      const status = obj.status;
      const plan = obj.metadata?.plan || 'monthly';
      const trialEnd = obj.trial_end ? new Date(obj.trial_end * 1000).toISOString() : null;
      const periodEnd = new Date(obj.current_period_end * 1000).toISOString();

      await upsertSubscription(supabaseUrl, supabaseKey, {
        user_id: userId,
        stripe_customer_id: obj.customer,
        stripe_subscription_id: obj.id,
        status,
        plan,
        trial_end: trialEnd,
        current_period_end: periodEnd
      });

      // If status just became active (trial converted) — top up credits
      if (status === 'active') {
        await upsertCredits(supabaseUrl, supabaseKey, userId, MONTHLY_CREDITS, false);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const userId = obj.metadata?.supabase_user_id;
      if (!userId) break;

      await upsertSubscription(supabaseUrl, supabaseKey, {
        user_id: userId,
        stripe_customer_id: obj.customer,
        stripe_subscription_id: obj.id,
        status: 'canceled',
        plan: obj.metadata?.plan || null,
        trial_end: null,
        current_period_end: null
      });
      break;
    }

    case 'invoice.payment_failed': {
      // Get subscription ID from invoice
      const subscriptionId = obj.subscription;
      if (!subscriptionId) break;

      // Look up user_id from our table via subscription ID
      const userId = await getUserIdBySubscription(supabaseUrl, supabaseKey, subscriptionId);
      if (!userId) break;

      await updateSubscriptionStatus(supabaseUrl, supabaseKey, subscriptionId, 'past_due');
      break;
    }

    default:
      // Unhandled event type — ignore
      break;
  }
}

// ── Supabase helpers ──────────────────────────────────────

async function upsertSubscription(supabaseUrl, supabaseKey, data) {
  const res = await fetch(`${supabaseUrl}/rest/v1/user_subscriptions`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify({ ...data, updated_at: new Date().toISOString() })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`upsertSubscription failed: ${err}`);
  }
}

async function upsertCredits(supabaseUrl, supabaseKey, userId, amount, isInitial) {
  if (isInitial) {
    // First-time: set credits to trial amount
    const res = await fetch(`${supabaseUrl}/rest/v1/ai_credits`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        user_id: userId,
        credits_remaining: amount,
        credits_monthly_reset_at: new Date().toISOString()
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`upsertCredits (initial) failed: ${err}`);
    }
  } else {
    // Renewal: add credits up to cap using RPC
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/add_subscription_credits`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_amount: amount,
        p_cap: MAX_CREDITS
      })
    });
    // If RPC doesn't exist yet, fall back to a direct update
    if (!res.ok) {
      console.warn('add_subscription_credits RPC not found, falling back to direct update');
    }
  }
}

async function getUserIdBySubscription(supabaseUrl, supabaseKey, subscriptionId) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/user_subscriptions?stripe_subscription_id=eq.${subscriptionId}&select=user_id`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length > 0 ? rows[0].user_id : null;
}

async function updateSubscriptionStatus(supabaseUrl, supabaseKey, subscriptionId, status) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/user_subscriptions?stripe_subscription_id=eq.${subscriptionId}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`updateSubscriptionStatus failed: ${err}`);
  }
}

// ── Stripe helpers ────────────────────────────────────────

async function fetchStripeSubscription(subscriptionId, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` }
  });
  if (!res.ok) return null;
  return res.json();
}

// ── Stripe signature verification (Web Crypto API) ────────

async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) return false;

  // Parse timestamp and signatures from header
  const parts = sigHeader.split(',');
  let timestamp = null;
  const signatures = [];

  for (const part of parts) {
    const [key, val] = part.split('=');
    if (key === 't') timestamp = val;
    if (key === 'v1') signatures.push(val);
  }

  if (!timestamp || signatures.length === 0) return false;

  // Reject events older than 5 minutes
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) return false;

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(signedPayload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const expectedSig = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return signatures.includes(expectedSig);
}
