// ==========================================================
// functions/api/create-portal.js
// Cloudflare Pages Function — Stripe Billing Portal
//
// POST /api/create-portal
// Auth: JWT via _middleware.js (same pattern as create-checkout.js)
// Returns: { url: string } — redirect to Stripe Customer Portal
//
// PREREQUISITE: Stripe Customer Portal must be configured at
//   https://dashboard.stripe.com/test/settings/billing/portal
//   before this endpoint will work.
//
// Env vars required (already set on Pages from Session 33):
//   STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
// ==========================================================

export async function onRequestPost(context) {
  const { env, request } = context;

  // ── AUTH ────────────────────────────────────────────────
  // _middleware.js has already verified the JWT and set the
  // Authorization header. We pass the user's JWT directly to
  // Supabase so RLS limits the row to their own record.
  const authHeader = request.headers.get('Authorization') || '';
  const userJwt = authHeader.replace('Bearer ', '').trim();
  if (!userJwt) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // ── LOOK UP STRIPE CUSTOMER ID ───────────────────────
    // Use the user's JWT so RLS returns only their row.
    const supabaseUrl    = env.SUPABASE_URL;
    const supabaseAnonKey = env.SUPABASE_ANON_KEY;

    const subRes = await fetch(
      `${supabaseUrl}/rest/v1/user_subscriptions?select=stripe_customer_id`,
      {
        headers: {
          'apikey':        supabaseAnonKey,
          'Authorization': `Bearer ${userJwt}`,
          'Accept':        'application/json',
        },
      }
    );

    const rows = await subRes.json();
    const customerId = rows?.[0]?.stripe_customer_id;

    if (!customerId) {
      return Response.json(
        { error: 'No Stripe customer found. Please complete checkout first.' },
        { status: 404 }
      );
    }

    // ── CREATE PORTAL SESSION ────────────────────────────
    const returnUrl = new URL(request.url).origin + '/dashboard.html?tab=billing';

    const params = new URLSearchParams({
      customer:   customerId,
      return_url: returnUrl,
    });

    const portalRes = await fetch(
      'https://api.stripe.com/v1/billing_portal/sessions',
      {
        method: 'POST',
        headers: {
          'Authorization':  `Basic ${btoa(env.STRIPE_SECRET_KEY + ':')}`,
          'Content-Type':   'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    );

    const portal = await portalRes.json();

    if (portal.url) {
      return Response.json({ url: portal.url });
    }

    // Stripe error — surface safely
    console.error('Stripe portal error:', JSON.stringify(portal));
    return Response.json(
      { error: portal?.error?.message || 'Could not create portal session' },
      { status: 500 }
    );

  } catch (e) {
    console.error('create-portal exception:', e);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
