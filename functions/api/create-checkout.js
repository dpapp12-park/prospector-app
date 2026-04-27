// Cloudflare Pages Function — Stripe checkout session creator
// Route: /api/create-checkout
// Requires: JWT from _middleware.js (user must be logged in)
// Body: { priceId: 'price_...' }
// Returns: { url: 'https://checkout.stripe.com/...' }

export async function onRequestPost(context) {
  const { request, env } = context;

  const STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_SECRET_KEY) {
    return jsonResponse({ error: 'Stripe not configured' }, 500);
  }

  // User is already verified by _middleware.js — pull from request context
  const userId = request.headers.get('x-user-id');
  const userEmail = request.headers.get('x-user-email');

  if (!userId) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const { priceId } = body;
  if (!priceId) {
    return jsonResponse({ error: 'priceId is required' }, 400);
  }

  // Valid price IDs only
  const VALID_PRICE_IDS = [
    'price_1TQtUOK5wRMqB1R5aTnlJgbm', // monthly $12.99
    'price_1TQtX5K5wRMqB1R5a8akd72q'  // annual $129.90
  ];
  if (!VALID_PRICE_IDS.includes(priceId)) {
    return jsonResponse({ error: 'Invalid price ID' }, 400);
  }

  try {
    // Check if user already has a Stripe customer ID
    let stripeCustomerId = null;

    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const subRes = await fetch(
        `${SUPABASE_URL}/rest/v1/user_subscriptions?user_id=eq.${userId}&select=stripe_customer_id`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          }
        }
      );
      if (subRes.ok) {
        const rows = await subRes.json();
        if (rows.length > 0 && rows[0].stripe_customer_id) {
          stripeCustomerId = rows[0].stripe_customer_id;
        }
      }
    }

    // If no existing customer, create one in Stripe
    if (!stripeCustomerId) {
      const customerRes = await stripePost('/v1/customers', {
        email: userEmail,
        metadata: { supabase_user_id: userId }
      }, STRIPE_SECRET_KEY);

      if (!customerRes.ok) {
        const err = await customerRes.json();
        return jsonResponse({ error: 'Failed to create customer', detail: err }, 500);
      }
      const customer = await customerRes.json();
      stripeCustomerId = customer.id;
    }

    // Determine plan label for metadata
    const plan = priceId === 'price_1TQtX5K5wRMqB1R5a8akd72q' ? 'annual' : 'monthly';

    // Create Stripe Checkout session
    const sessionRes = await stripePost('/v1/checkout/sessions', {
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      'subscription_data[trial_period_days]': 14,
      'subscription_data[metadata][supabase_user_id]': userId,
      'subscription_data[metadata][plan]': plan,
      'payment_method_collection': 'always',
      success_url: `https://unworkedgold.com/?checkout=success`,
      cancel_url: `https://unworkedgold.com/?checkout=canceled`,
      allow_promotion_codes: true
    }, STRIPE_SECRET_KEY);

    if (!sessionRes.ok) {
      const err = await sessionRes.json();
      return jsonResponse({ error: 'Failed to create checkout session', detail: err }, 500);
    }

    const session = await sessionRes.json();
    return jsonResponse({ url: session.url });

  } catch (e) {
    return jsonResponse({ error: 'Server error', detail: e.message }, 500);
  }
}

// ── helpers ──────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

async function stripePost(path, params, secretKey) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      body.append(key, String(value));
    }
  }
  return fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
}
