// Cloudflare Pages Function — Claim Monitoring Alerts
// Route: /api/alerts
// Triggered: daily cron at 6am UTC via wrangler.toml OR manually via POST
// Checks all watched claims for: expiry approaching, status change, new nearby claims
// Sends email alerts via Resend API from alerts@unworkedgold.com

const SUPABASE_URL = 'https://condhfwpzlxrzuadgopc.supabase.co';
const FROM_EMAIL   = 'alerts@unworkedgold.com';
const APP_URL      = 'https://unworkedgold.com';
const EXPIRY_WARN_DAYS = 90; // Alert when claim expires within this many days

// ── Entry point ──────────────────────────────────────────────────────────────
export async function onRequestPost(context) {
  const { env } = context;
  const result = await runAlerts(env);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Cron trigger (set up in wrangler.toml or Cloudflare dashboard)
export async function scheduled(event, env) {
  await runAlerts(env);
}

// ── Main alert runner ─────────────────────────────────────────────────────────
async function runAlerts(env) {
  const supabaseKey = env.SUPABASE_SERVICE_KEY;
  const resendKey   = env.RESEND_KEY;

  if (!supabaseKey || !resendKey) {
    return { error: 'Missing environment variables', sent: 0 };
  }

  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json'
  };

  // 1. Get all watches with notify_email = true
  const watchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/claim_watches?notify_email=eq.true&select=*`,
    { headers }
  );
  const watches = await watchRes.json();
  if (!watches?.length) return { message: 'No watches found', sent: 0 };

  // 2. Get user emails for all watched users
  const userIds = [...new Set(watches.map(w => w.user_id))];
  const userEmails = await getUserEmails(userIds, headers);

  // 3. Check each watch and collect alerts
  const alertsByUser = {};
  const today = new Date();

  for (const watch of watches) {
    const email = userEmails[watch.user_id];
    if (!email) continue;

    const alerts = await checkClaim(watch, today, headers);
    if (!alerts.length) continue;

    if (!alertsByUser[email]) {
      alertsByUser[email] = { email, watches: [] };
    }
    alertsByUser[email].watches.push({ watch, alerts });
  }

  // 4. Send one digest email per user
  let sent = 0;
  for (const userData of Object.values(alertsByUser)) {
    const success = await sendAlertEmail(userData, resendKey);
    if (success) sent++;
  }

  return { message: `Alerts checked`, sent, users: Object.keys(alertsByUser).length };
}

// ── Get user emails from Supabase Auth admin API ─────────────────────────────
async function getUserEmails(userIds, headers) {
  const emails = {};
  try {
    const supabaseKey = headers['apikey'];
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      }
    );
    if (res.ok) {
      const data = await res.json();
      const users = data.users || [];
      for (const user of users) {
        if (userIds.includes(user.id)) {
          emails[user.id] = user.email;
        }
      }
    }
  } catch(e) {
    console.error('Failed to get user emails:', e);
  }
  return emails;
}

// ── Check a single claim for alert conditions ─────────────────────────────────
async function checkClaim(watch, today, headers) {
  const alerts = [];
  const serial = watch.serial_number;

  try {
    // Fetch current claim data
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/mining_claims_active?cse_nr=eq.${serial}&select=cse_nr,cse_nm,cse_disp_dt,cse_exp_dt,cse_status,longitude,latitude&limit=1`,
      { headers }
    );
    const claims = await res.json();

    if (!claims?.length) {
      // Claim no longer in active table — may have closed
      alerts.push({
        type: 'status_change',
        message: `${watch.claim_name} is no longer in the active claims database. It may have lapsed or been closed.`,
        severity: 'high'
      });
      return alerts;
    }

    const claim = claims[0];

    // Check expiry approaching
    if (claim.cse_exp_dt) {
      const expDate = new Date(claim.cse_exp_dt);
      const daysUntilExpiry = Math.floor((expDate - today) / (1000 * 60 * 60 * 24));
      if (daysUntilExpiry <= EXPIRY_WARN_DAYS && daysUntilExpiry > 0) {
        alerts.push({
          type: 'expiry',
          message: `${watch.claim_name} expires in ${daysUntilExpiry} days (${formatDate(expDate)}).`,
          severity: daysUntilExpiry <= 30 ? 'high' : 'medium',
          daysUntilExpiry
        });
      }
    }

    // Check for new claims filed nearby (within ~5 miles)
    if (claim.latitude && claim.longitude) {
      const nearbyAlerts = await checkNearbyClaims(
        claim.latitude, claim.longitude, watch, headers
      );
      alerts.push(...nearbyAlerts);
    }

  } catch(e) {
    console.error('Error checking claim', serial, e);
  }

  return alerts;
}

// ── Check for new claims filed nearby ────────────────────────────────────────
async function checkNearbyClaims(lat, lng, watch, headers) {
  const alerts = [];
  try {
    // Look for claims filed in the last 7 days within ~5 miles
    // 5 miles ~ 0.072 degrees lat/lng
    const delta = 0.072;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/mining_claims_active?` +
      `latitude=gte.${lat - delta}&latitude=lte.${lat + delta}` +
      `&longitude=gte.${lng - delta}&longitude=lte.${lng + delta}` +
      `&cse_disp_dt=gte.${sevenDaysAgo}` +
      `&cse_nr=neq.${watch.serial_number}` +
      `&select=cse_nr,cse_nm,cse_disp_dt&limit=5`,
      { headers }
    );
    const nearby = await res.json();

    if (nearby?.length) {
      alerts.push({
        type: 'nearby_filing',
        message: `${nearby.length} new claim${nearby.length > 1 ? 's' : ''} filed within 5 miles of ${watch.claim_name} in the last 7 days.`,
        severity: 'low',
        count: nearby.length
      });
    }
  } catch(e) {
    console.error('Error checking nearby claims', e);
  }
  return alerts;
}

// ── Send digest email via Resend ──────────────────────────────────────────────
async function sendAlertEmail(userData, resendKey) {
  const { email, watches } = userData;

  const alertCount = watches.reduce((n, w) => n + w.alerts.length, 0);
  const highPriority = watches.some(w => w.alerts.some(a => a.severity === 'high'));

  const subject = highPriority
    ? `⚠️ Urgent: ${alertCount} claim alert${alertCount > 1 ? 's' : ''} — Unworked Gold`
    : `🔔 ${alertCount} claim alert${alertCount > 1 ? 's' : ''} — Unworked Gold`;

  const html = buildEmailHTML(watches);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `Unworked Gold Alerts <${FROM_EMAIL}>`,
        to: [email],
        subject,
        html
      })
    });

    const data = await res.json();
    return res.ok;
  } catch(e) {
    console.error('Failed to send email to', email, e);
    return false;
  }
}

// ── Email HTML template ───────────────────────────────────────────────────────
function buildEmailHTML(watches) {
  const alertRows = watches.map(({ watch, alerts }) => {
    const alertItems = alerts.map(a => {
      const icon = a.severity === 'high' ? '⚠️' : a.type === 'nearby_filing' ? '📍' : '🔔';
      return `<li style="margin-bottom:8px;padding:10px 14px;background:${a.severity === 'high' ? '#FFF3E0' : '#F5F5F5'};border-radius:6px;border-left:3px solid ${a.severity === 'high' ? '#FF9800' : '#90A4AE'};">
        ${icon} ${a.message}
      </li>`;
    }).join('');

    return `
      <div style="margin-bottom:24px;padding:16px;border:1px solid #E0E0E0;border-radius:8px;">
        <div style="font-weight:600;font-size:16px;color:#1A1A1A;margin-bottom:12px;">
          📋 ${watch.claim_name}
          <span style="font-size:12px;font-weight:400;color:#757575;margin-left:8px;">${watch.serial_number}</span>
        </div>
        <ul style="list-style:none;padding:0;margin:0;">${alertItems}</ul>
        <a href="${APP_URL}" style="display:inline-block;margin-top:12px;font-size:13px;color:#B8860B;text-decoration:none;">
          View on map →
        </a>
      </div>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F2EC;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">

    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:22px;font-weight:700;color:#1A1A1A;margin:0 0 4px 0;">Unworked Gold</h1>
      <p style="color:#757575;font-size:14px;margin:0;">Claim Monitoring Alert</p>
    </div>

    ${alertRows}

    <div style="margin-top:32px;padding-top:24px;border-top:1px solid #E0E0E0;text-align:center;">
      <a href="${APP_URL}" style="display:inline-block;background:#B8860B;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:14px;">
        Open Unworked Gold
      </a>
      <p style="color:#9E9E9E;font-size:12px;margin-top:16px;">
        You're receiving this because you're watching claims on Unworked Gold.<br>
        <a href="${APP_URL}" style="color:#9E9E9E;">Manage your watches</a>
      </p>
    </div>

  </div>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
