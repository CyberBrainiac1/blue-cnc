// The Onshape side of GRBL Prep: sign in, list the NC files imported into the open document,
// read one, and save the converted file back as a new tab.

// Filled in once the app is registered in Onshape and the Worker is running.
// The client ID isn't a secret. The client secret only ever lives in the Worker.
export const SETUP = {
  clientId: '',
  worker: '', // e.g. https://grbl-prep-onshape.yourname.workers.dev
};

const NC_FILE = /\.(nc|ngc|gcode|tap|txt|cnc|g|ncl)$/i;

// Onshape opens the page in an iframe with the document's ids in the query string.
export function onshapeContext() {
  const q = new URLSearchParams(location.search);
  const documentId = q.get('documentId');
  const workspaceId = q.get('workspaceId') || q.get('workspaceOrVersionId');
  if (!documentId || !workspaceId) return null;
  return { documentId, workspaceId, elementId: q.get('elementId'), server: q.get('server') || 'https://cad.onshape.com' };
}

export const isSetUp = () => !!(SETUP.clientId && SETUP.worker);

// Onshape won't talk to the iframe until it hears a keepAlive, and it ends idle sessions without them.
export function keepOnshapeAwake(ctx) {
  const send = () => window.parent.postMessage({
    messageName: 'keepAlive', documentId: ctx.documentId, workspaceId: ctx.workspaceId, elementId: ctx.elementId,
  }, ctx.server);
  send();
  setInterval(send, 5 * 60 * 1000);
}

function tokens() {
  try { return JSON.parse(sessionStorage.getItem('grblprep.onshape')) || null; } catch { return null; }
}

function keep(t) {
  try { sessionStorage.setItem('grblprep.onshape', JSON.stringify(t)); } catch {}
}

export const signedIn = () => !!tokens()?.access_token;

// Onshape's sign-in page can't load inside an iframe, so it goes in a popup.
export function signIn() {
  const state = crypto.randomUUID();
  const url = new URL('https://oauth.onshape.com/oauth/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: SETUP.clientId,
    redirect_uri: SETUP.worker + '/oauth/callback',
    state,
  });
  const popup = window.open(url, 'onshapeSignIn', 'width=520,height=700');
  if (!popup) return Promise.reject(new Error('The sign-in popup was blocked. Allow popups for this page and try again.'));

  return new Promise((resolve, reject) => {
    function heard(e) {
      if (e.origin !== location.origin || !e.data?.grblPrepSignIn) return;
      window.removeEventListener('message', heard);
      const f = e.data.grblPrepSignIn;
      if (f.error) return reject(new Error(`Onshape sign-in didn't work: ${f.error}`));
      if (f.state !== state) return reject(new Error('Sign-in reply didn\'t match. Try again.'));
      keep({ access_token: f.access_token, refresh_token: f.refresh_token });
      resolve();
    }
    window.addEventListener('message', heard);
  });
}

async function refresh() {
  const reply = await fetch(SETUP.worker + '/oauth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens()?.refresh_token }),
  });
  const t = await reply.json();
  if (!t.access_token) {
    sessionStorage.removeItem('grblprep.onshape');
    throw new Error('Your Onshape sign-in ran out. Sign in again.');
  }
  keep(t);
}

// Onshape access tokens last an hour, so a 401 means get a fresh one and try once more.
async function api(path, options = {}, retry = true) {
  const reply = await fetch(SETUP.worker + path, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${tokens()?.access_token}` },
  });
  if (reply.status === 401 && retry) {
    await refresh();
    return api(path, options, false);
  }
  if (!reply.ok) throw new Error(`Onshape said ${reply.status} for that request.`);
  return reply;
}

export async function listNcFiles(ctx) {
  const reply = await api(`/api/v6/documents/d/${ctx.documentId}/w/${ctx.workspaceId}/elements?elementType=BLOB`);
  const tabs = await reply.json();
  return tabs
    .filter(t => NC_FILE.test(t.filename || t.name || ''))
    .map(t => ({ id: t.id, name: t.name || t.filename }));
}

export async function readFile(ctx, elementId) {
  const reply = await api(`/api/v6/blobelements/d/${ctx.documentId}/w/${ctx.workspaceId}/e/${elementId}`, {
    headers: { Accept: 'application/octet-stream' },
  });
  return reply.text();
}

export async function saveToDocument(ctx, name, lines) {
  const form = new FormData();
  form.append('file', new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }), name);
  form.append('encodedFilename', name);
  await api(`/api/v6/blobelements/d/${ctx.documentId}/w/${ctx.workspaceId}`, { method: 'POST', body: form });
}

// ---------- parts, for cutting a flat part ----------

export async function listPartStudios(ctx) {
  const reply = await api(`/api/v6/documents/d/${ctx.documentId}/w/${ctx.workspaceId}/elements?elementType=PARTSTUDIO`);
  return (await reply.json()).map(t => ({ id: t.id, name: t.name }));
}

export async function listParts(ctx, elementId) {
  const reply = await api(`/api/v6/parts/d/${ctx.documentId}/w/${ctx.workspaceId}/e/${elementId}`);
  return (await reply.json())
    .filter(p => !p.bodyType || p.bodyType === 'solid')
    .map(p => ({ id: p.partId, name: p.name }));
}

// The faces of a part and the points along its edges, which is all the CAM needs.
export async function readPart(ctx, elementId, partId) {
  const base = `/api/v6/parts/d/${ctx.documentId}/w/${ctx.workspaceId}/e/${elementId}/partid/${encodeURIComponent(partId)}`;
  const [body, edges] = await Promise.all([
    api(`${base}/bodydetails?includeGeometricData=true`).then(r => r.json()),
    api(`${base}/tessellatededges?chordTolerance=0.00005&angleTolerance=0.1`).then(r => r.json()),
  ]);
  return { body, edges };
}
