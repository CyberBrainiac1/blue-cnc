import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const env = { CLIENT_ID: 'client123', CLIENT_SECRET: 'not-a-real-secret', APP_URL: 'https://example.github.io/blue-cnc/vibe-app/' };
const realFetch = globalThis.fetch;
let calls;

// A pretend Onshape that records what the Worker asks it.
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body;
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers, body });
    if (String(url).includes('/oauth/token')) {
      return Response.json({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600 });
    }
    return new Response('[{"id":"e1","filename":"part.nc"}]', { headers: { 'Content-Type': 'application/json' } });
  };
});

afterEach(() => { globalThis.fetch = realFetch; });

const ask = (path, init) => worker.fetch(new Request('https://w.example.workers.dev' + path, init), env);

test('the sign-in callback swaps the code and sends tokens back in the fragment', async () => {
  const reply = await ask('/oauth/callback?code=abc&state=s1');
  assert.equal(reply.status, 302);
  const to = new URL(reply.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://example.github.io/blue-cnc/vibe-app/signed_in.html');
  assert.equal(to.search, '', 'tokens never go in the query string');
  const back = new URLSearchParams(to.hash.slice(1));
  assert.equal(back.get('access_token'), 'acc');
  assert.equal(back.get('state'), 's1');
  const sent = calls[0].body;
  assert.equal(sent.grant_type, 'authorization_code');
  assert.equal(sent.client_secret, 'not-a-real-secret');
  assert.equal(sent.redirect_uri, 'https://w.example.workers.dev/oauth/callback');
});

test('refresh hands back new tokens with CORS for the app only', async () => {
  const reply = await ask('/oauth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: 'old' }) });
  assert.equal((await reply.json()).access_token, 'acc');
  assert.equal(reply.headers.get('Access-Control-Allow-Origin'), 'https://example.github.io');
  assert.equal(calls[0].body.grant_type, 'refresh_token');
});

test('only the Onshape calls the page needs get through', async () => {
  const list = await ask('/api/v6/documents/d/abc/w/def/elements?elementType=BLOB', { headers: { Authorization: 'Bearer acc' } });
  assert.equal(list.status, 200);
  assert.equal(calls[0].url, 'https://cad.onshape.com/api/v6/documents/d/abc/w/def/elements?elementType=BLOB');
  assert.equal(calls[0].headers.Authorization, 'Bearer acc');

  for (const path of [
    '/api/v6/parts/d/abc/w/def/e/ghi',
    '/api/v6/parts/d/abc/w/def/e/ghi/partid/JHD/bodydetails',
    '/api/v6/parts/d/abc/w/def/e/ghi/partid/JHD/tessellatededges',
    '/api/v6/parts/d/abc/w/def/e/ghi/partid/JHD/tessellatedfaces',
    '/api/v6/partstudios/d/abc/w/def/e/ghi/bodydetails',
  ]) {
    assert.equal((await ask(path)).status, 200, path);
  }
  for (const path of [
    '/api/v6/parts/d/abc/w/def',
    '/api/v6/parts/d/abc/w/def/e/ghi/partid/JHD/massproperties',
    '/api/v6/partstudios/d/abc/w/def/e/ghi/tessellatedfaces',
    '/api/v6/documents/d/abc',
    '/api/v6/users/sessioninfo',
  ]) {
    assert.equal((await ask(path)).status, 404, path);
  }
  assert.equal((await ask('/api/v6/blobelements/d/a/w/b/e/c', { method: 'DELETE' })).status, 404);
  assert.equal((await ask('/api/v6/parts/d/abc/w/def/e/ghi', { method: 'POST' })).status, 404);
  assert.equal(calls.length, 6);
});
