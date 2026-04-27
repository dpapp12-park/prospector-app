// Cloudflare Pages Function — server-side proxy for Anthropic API
// Prevents CORS issues and keeps the API key out of the browser
// Route: /api/claude

const ALLOWED_ORIGINS = [
  'https://prospector-app.pages.dev',
  'https://unworkedgold.com',
];

const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-20250514',
]);

const MAX_TOKENS_CAP = 1000;
const MAX_BODY_BYTES = 6_000_000; // ~6MB

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const apiKey = env.ANTHROPIC_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_KEY environment variable not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // Body size check (content-length header)
  if (parseInt(request.headers.get('content-length') || '0') > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: 'Body too large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch(e) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // Model allowlist
  if (!ALLOWED_MODELS.has(body.model)) {
    return new Response(JSON.stringify({ error: 'Model not allowed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  }

  // max_tokens cap — clamp silently rather than reject
  if (body.max_tokens > MAX_TOKENS_CAP) {
    body.max_tokens = MAX_TOKENS_CAP;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request)
    }
  });
}

export async function onRequestOptions(context) {
  return new Response(null, {
    headers: corsHeaders(context.request)
  });
}
