// Cloudflare Pages Function — server-side proxy for Anthropic API
// Prevents CORS issues and keeps the API key out of the browser
// Route: /api/claude

export async function onRequestPost(context) {
  const { request, env } = context;

  const apiKey = env.ANTHROPIC_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_KEY environment variable not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch(e) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
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
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
