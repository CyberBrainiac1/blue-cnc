// Cloudflare Worker for GRBL Prep's Onshape sign-in.
// It does the two jobs a static page can't: swap Onshape's sign-in code for tokens (that needs the
// client secret, which lives here as a Worker secret), and pass the page's few Onshape API calls
// through, since Onshape's API doesn't answer browser requests from other sites.
//
// Settings (Workers > this worker > Settings > Variables):
//   CLIENT_ID      the OAuth client ID from Onshape's developer portal
//   CLIENT_SECRET  the OAuth client secret (add it as an encrypted secret)
//   APP_URL        where the page lives, e.g. https://cyberbrainiac1.github.io/blue-cnc/vibe-app/

const ONSHAPE = 'https://cad.onshape.com';
const TOKEN_URL = 'https://oauth.onshape.com/oauth/token';

// The only Onshape API calls the page makes: list a document's tabs, read a file tab, add a file
// tab, list the parts in a Part Studio, and read one part's faces and edges. All read-only except
// adding a file tab.
const ALLOWED = [
  ['GET', /^\/api\/v6\/documents\/d\/\w+\/w\/\w+\/elements$/],
  ['GET', /^\/api\/v6\/blobelements\/d\/\w+\/w\/\w+\/e\/\w+$/],
  ['POST', /^\/api\/v6\/blobelements\/d\/\w+\/w\/\w+$/],
  ['GET', /^\/api\/v6\/parts\/d\/\w+\/w\/\w+\/e\/\w+$/],
  ['GET', /^\/api\/v6\/parts\/d\/\w+\/w\/\w+\/e\/\w+\/partid\/[\w%.-]+\/(bodydetails|tessellatededges)$/],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = new URL(env.APP_URL).origin;
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/oauth/callback') return finishSignIn(url, env);

    if (url.pathname === '/oauth/refresh' && request.method === 'POST') {
      const { refresh_token } = await request.json();
      const tokens = await askForTokens(env, { grant_type: 'refresh_token', refresh_token });
      return Response.json(tokens.body, { status: tokens.status, headers: cors });
    }

    const allowed = ALLOWED.some(([method, path]) => method === request.method && path.test(url.pathname));
    if (allowed) {
      const reply = await fetch(ONSHAPE + url.pathname + url.search, {
        method: request.method,
        headers: {
          Authorization: request.headers.get('Authorization') || '',
          Accept: request.headers.get('Accept') || 'application/json',
          ...(request.headers.get('Content-Type') ? { 'Content-Type': request.headers.get('Content-Type') } : {}),
        },
        body: request.method === 'POST' ? request.body : undefined,
      });
      const headers = new Headers(cors);
      headers.set('Content-Type', reply.headers.get('Content-Type') || 'application/octet-stream');
      return new Response(reply.body, { status: reply.status, headers });
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};

async function askForTokens(env, fields) {
  const reply = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...fields, client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET }),
  });
  return { status: reply.status, body: await reply.json().catch(() => ({ error: 'bad reply from Onshape' })) };
}

// Onshape sends the sign-in popup here. Swap the code for tokens, then hand them to the
// page's signed_in.html in the URL fragment, which browsers never send to any server.
async function finishSignIn(url, env) {
  const back = new URL('signed_in.html', env.APP_URL);
  const code = url.searchParams.get('code');
  if (!code) {
    back.hash = new URLSearchParams({ error: url.searchParams.get('error') || 'no code' });
    return Response.redirect(back.toString(), 302);
  }
  const tokens = await askForTokens(env, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: url.origin + '/oauth/callback',
  });
  const b = tokens.body;
  back.hash = new URLSearchParams(b.access_token
    ? { access_token: b.access_token, refresh_token: b.refresh_token, expires_in: b.expires_in, state: url.searchParams.get('state') || '' }
    : { error: b.error_description || b.error || 'sign-in failed' });
  return Response.redirect(back.toString(), 302);
}
