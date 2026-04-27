// Cloudflare Pages Function — JWT middleware
// Runs before every /api/* request
// Route: /functions/api/_middleware.js

export async function onRequest(context) {
  const { request, env, next } = context;

  // Public paths — bypass JWT check
  const publicPaths = ['/api/stripe/webhook'];
  if (publicPaths.includes(new URL(request.url).pathname)) {
    return next();
  }

  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const token = auth.slice(7);
  const userResp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`
    }
  });

  if (!userResp.ok) {
    return new Response('Invalid token', { status: 401 });
  }

  const user = await userResp.json();
  context.data = { userId: user.id };

  return next();
}
