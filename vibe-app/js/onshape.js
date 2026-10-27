// The Onshape side of GRBL Prep: sign in, read a part from a Part Studio, list the NC files
// imported into the open document, and save a GRBL file back as a new tab.

// Filled in once the app is registered in Onshape and the Worker is running.
// The client ID isn't a secret. The client secret only ever lives in the Worker.
export const SETUP = {
  clientId: 'X5HZCQIYICAK4VNX5XQHEZEMEYT622MX52CU7QA=',
  worker: 'https://grbl-prep-onshape.emmadipranav.workers.dev',
};

const NC_FILE = /\.(nc|ngc|gcode|tap|txt|cnc|g|ncl)$/i;

// Onshape opens the page in an iframe with the document's ids in the query string. The extension's
// action URL can also leave unfilled "{$documentId}" copies in front of the real ids, so take the
// first value that looks like an Onshape id (24 hex characters).
export function onshapeContext() {
  const q = new URLSearchParams(location.search);
  const id = (...names) => names.flatMap(n => q.getAll(n)).find(v => /^[0-9a-f]{24}$/.test(v)) || null;
  const documentId = id('documentId');
  const workspaceId = id('workspaceId', 'workspaceOrVersionId');
  if (!documentId || !workspaceId) return null;
  return {
    documentId, workspaceId, elementId: id('elementId'), server: q.get('server') || 'https://cad.onshape.com',
    // opened in the right-hand panel of a Part Studio rather than as a tab of its own
    panel: q.get('panel') === '1',
  };
}

export const isSetUp = () => !!(SETUP.clientId && SETUP.worker);

// applicationInit tells Onshape the page is ready for messages, which starts the SELECTION
// messages in the side panel. Onshape ends idle sessions without a keepAlive now and then.
export function keepOnshapeAwake(ctx) {
  const send = messageName => window.parent.postMessage({
    messageName, documentId: ctx.documentId, workspaceId: ctx.workspaceId, elementId: ctx.elementId,
  }, ctx.server);
  send('applicationInit');
  send('keepAlive');
  setInterval(() => send('keepAlive'), 5 * 60 * 1000);
}

// Calls back with the ids of whatever is selected in the Part Studio (parts, faces or edges),
// each time the selection changes.
export function onSelection(ctx, callback) {
  window.addEventListener('message', e => {
    if (e.origin !== ctx.server || e.data?.messageName !== 'SELECTION') return;
    fetch(SETUP.worker + '/debug-selection?' + new URLSearchParams({ s: JSON.stringify(e.data.selections) })).catch(() => {}); // TEMP
    callback((e.data.selections || []).map(s => s.selectionId).filter(Boolean));
  });
}

// Tokens live in localStorage, so a sign-in lasts past closing the tab. The refresh token keeps
// it going after the hour-long access token runs out.
const STORE = 'grblprep.onshape';

function tokens() {
  try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch { return null; }
}

function keep(t) {
  try { localStorage.setItem(STORE, JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token })); } catch {}
}

function forget() {
  try { localStorage.removeItem(STORE); } catch {}
}

export const signedIn = () => !!tokens()?.access_token;

function authorizeUrl(state) {
  const url = new URL('https://oauth.onshape.com/oauth/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: SETUP.clientId,
    redirect_uri: SETUP.worker + '/oauth/callback',
    state,
  });
  return url;
}

// signed_in.html posts the tokens back here, from the popup or from the hidden frame.
function waitForTokens(state, ms) {
  return new Promise((resolve, reject) => {
    const timer = ms && setTimeout(() => { window.removeEventListener('message', heard); reject(new Error('timed out')); }, ms);
    function heard(e) {
      if (e.origin !== location.origin || e.data?.grblPrepSignIn?.state !== state) return;
      window.removeEventListener('message', heard);
      clearTimeout(timer);
      const f = e.data.grblPrepSignIn;
      if (f.error || !f.access_token) return reject(new Error(`Onshape sign-in didn't work: ${f.error || 'no token'}`));
      keep(f);
      resolve();
    }
    window.addEventListener('message', heard);
  });
}

// Once someone has allowed GRBL Prep, Onshape's authorize page sends them straight back with a
// code and shows nothing. So try that in a hidden frame first: the page never leaves, and if
// Onshape wants to show a page instead (the first time, or when signed out), it just times out.
export async function signInQuietly() {
  const state = crypto.randomUUID();
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = authorizeUrl(state);
  document.body.append(frame);
  try {
    await waitForTokens(state, 10000);
    return true;
  } catch {
    return false;
  } finally {
    frame.remove();
  }
}

// The first time, Onshape asks the user to allow the app. That page can't load inside a frame,
// so it goes in a popup.
export function signIn() {
  const state = crypto.randomUUID();
  const popup = window.open(authorizeUrl(state), 'onshapeSignIn', 'width=520,height=700');
  if (!popup) return Promise.reject(new Error('The sign-in popup was blocked. Allow popups for this page and try again.'));
  return waitForTokens(state);
}

// Swaps the refresh token for new ones, or failing that tries the quiet sign-in again.
async function refresh() {
  const saved = tokens()?.refresh_token;
  if (saved) {
    const reply = await fetch(SETUP.worker + '/oauth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: saved }),
    });
    const t = await reply.json().catch(() => ({}));
    if (t.access_token) return keep(t);
  }
  forget();
  if (!(await signInQuietly())) throw new SignInNeeded();
}

export class SignInNeeded extends Error {
  constructor() { super('Sign in to Onshape to see the parts in this document.'); }
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

// The part a selection belongs to. Picking a part in the Parts list gives the part's own id;
// clicking it in the view gives a face or edge id, so look those up in the Part Studio's bodies.
export async function partOfSelection(ctx, elementId, ids) {
  const reply = await api(`/api/v6/partstudios/d/${ctx.documentId}/w/${ctx.workspaceId}/e/${elementId}/bodydetails`);
  const bodies = (await reply.json()).bodies || [];
  const owner = id => bodies.find(b => b.id === id || [...(b.faces || []), ...(b.edges || [])].some(f => f.id === id));
  // the newest selection is last
  for (const id of [...ids].reverse()) {
    if (owner(id)) return owner(id).id;
  }
  return null;
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
