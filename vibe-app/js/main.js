import { convert, splitByTool, ConvertError, TEAM_MACHINE, fmt } from './convert.js';
import { toolpath } from './toolpath.js';
import { drawPath } from './preview.js';
import * as onshape from './onshape.js?v=6';
import { MATERIALS, BITS, settingsFor } from './cam.js';

const $ = id => document.getElementById(id);

let job = null;       // { name, source, lines, path, parts, kind }

// ---------- machine settings ----------

function loadMachine() {
  try {
    const saved = JSON.parse(localStorage.getItem('grblprep.machine'));
    if (saved && saved.travel) return saved;
  } catch {}
  return structuredClone(TEAM_MACHINE);
}

let machine = loadMachine();

function fillMachineForm() {
  for (const input of $('machine').querySelectorAll('input')) {
    const [a, b] = input.name.split('.');
    input.value = b ? machine[a][b] : machine[a];
  }
}

function readMachineForm() {
  for (const input of $('machine').querySelectorAll('input')) {
    const [a, b] = input.name.split('.');
    const value = input.type === 'number' ? parseFloat(input.value) || 0 : input.value;
    if (b) machine[a][b] = value; else machine[a] = value;
  }
  try { localStorage.setItem('grblprep.machine', JSON.stringify(machine)); } catch {}
}

function machineChanged() {
  if (job?.kind === 'cam') $('generateNote').textContent = 'The machine settings changed. Click Make toolpath again.';
  else if (job) loadText(job.name, job.source);
}

$('machine').addEventListener('change', () => {
  readMachineForm();
  machineChanged();
});

$('machineReset').addEventListener('click', () => {
  machine = structuredClone(TEAM_MACHINE);
  fillMachineForm();
  readMachineForm();
  machineChanged();
});

// ---------- the two tabs ----------

function showTab(cam) {
  $('tabCam').setAttribute('aria-selected', String(cam));
  $('tabGcode').setAttribute('aria-selected', String(!cam));
  $('camPanel').hidden = !cam;
  $('gcodePanel').hidden = cam;
  // the G-code tab has one step before the preview, cutting a part has three
  document.querySelectorAll('#previewPanel .step, #downloadPanel .step').forEach((el, i) => { el.textContent = (cam ? 4 : 2) + i; });
}

$('tabCam').addEventListener('click', () => showTab(true));
$('tabGcode').addEventListener('click', () => showTab(false));

// ---------- converting ----------

function listItem(item) {
  const li = document.createElement('li');
  li.textContent = item.line ? `Line ${item.line}: ${item.text}` : item.text;
  return li;
}

export function loadText(name, source) {
  $('result').hidden = false;
  $('fileName').textContent = name;
  $('refused').hidden = true;
  $('warnings').hidden = true;
  $('changes').replaceChildren();
  job = null;

  let result;
  try {
    result = convert(source, machine);
  } catch (err) {
    if (!(err instanceof ConvertError)) throw err;
    $('refused').hidden = false;
    $('refused').textContent = `This file can't be converted. Line ${err.lineNo} (${err.text.trim()}): ${err.reason}`;
    $('changesBox').hidden = true;
    clearJob();
    return;
  }

  setJob(name, result.lines, 'gcode', source);

  $('changesBox').hidden = false;
  $('changesTitle').textContent = result.changes.length ? `What changed (${result.changes.length})` : 'Nothing needed changing';
  result.changes.forEach(c => $('changes').append(listItem(c)));
  if (result.warnings.length) {
    $('warnings').hidden = false;
    const ul = document.createElement('ul');
    result.warnings.forEach(w => ul.append(listItem(w)));
    $('warnings').replaceChildren('Check these before you run it:', ul);
  }
}

function setJob(name, lines, kind, source = lines.join('\n')) {
  const path = toolpath(lines);
  job = { name, source, lines, path, parts: splitByTool(lines), kind };
  $('download').disabled = false;
  $('saveOnshape').hidden = !(onshapeCtx && onshape.signedIn());
  $('downloadParts').hidden = job.parts.length < 2;
  $('downloadParts').textContent = `Download one file per tool (${job.parts.length} files)`;
  $('cutTime').hidden = true;
  drawAll(path);
}

function clearJob() {
  job = null;
  $('download').disabled = true;
  $('downloadParts').hidden = true;
  $('saveOnshape').hidden = true;
  $('cutTime').hidden = true;
  drawAll(null);
}

function drawAll(path, done = 0) {
  drawPath($('top'), path, 'top', done);
  drawPath($('side'), path, 'side', done);
  if (path?.bounds) {
    const { min, max } = path.bounds;
    $('size').textContent = `The job runs from X${fmt(min.x)} to X${fmt(max.x)}, Y${fmt(min.y)} to Y${fmt(max.y)} and Z${fmt(min.z)} to Z${fmt(max.z)} mm.`;
  } else {
    $('size').textContent = '';
  }
}

function baseName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
}

function save(name, lines) {
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('download').addEventListener('click', () => save(`${baseName(job.name)}_grbl.nc`, job.lines));
$('downloadParts').addEventListener('click', () => {
  job.parts.forEach((lines, i) => setTimeout(() => save(`${baseName(job.name)}_tool${i + 1}_grbl.nc`, lines), i * 300));
});

async function readFile(file) {
  loadText(file.name, await file.text());
}

$('fileInput').addEventListener('change', e => e.target.files[0] && readFile(e.target.files[0]));
$('drop').addEventListener('dragover', e => { e.preventDefault(); $('drop').classList.add('over'); });
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
$('drop').addEventListener('drop', e => {
  e.preventDefault();
  $('drop').classList.remove('over');
  if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
});

// ---------- cutting a flat part ----------

let part = null; // { name, part } for a sample, { name, body, edges } straight from Onshape
const camWorker = new Worker(new URL('./camworker.js', import.meta.url), { type: 'module' });

for (const [key, m] of Object.entries(MATERIALS)) $('material').append(new Option(m.name, key));
for (const [key, b] of Object.entries(BITS)) $('bit').append(new Option(b.name, key));

function fillSettings() {
  const s = settingsFor($('material').value, $('bit').value);
  for (const input of $('camSettings').elements) {
    if (!input.name) continue;
    if (input.name === 'stepover') input.value = Math.round(s.stepover * 100);
    else input.value = String(s[input.name]);
  }
}

function readSettings() {
  const s = settingsFor($('material').value, $('bit').value);
  for (const input of $('camSettings').elements) {
    if (!input.name) continue;
    if (input.name === 'climb') s.climb = input.value === 'true';
    else if (input.name === 'stepover') s.stepover = parseFloat(input.value) / 100;
    else s[input.name] = parseFloat(input.value);
  }
  return s;
}

function pickMaterial() {
  fillSettings();
  try { localStorage.setItem('grblprep.cam', JSON.stringify({ material: $('material').value, bit: $('bit').value })); } catch {}
}

$('material').addEventListener('change', pickMaterial);
$('bit').addEventListener('change', pickMaterial);
$('settingsReset').addEventListener('click', fillSettings);

function usePart(name, data) {
  part = { name, ...data };
  $('partName').hidden = false;
  $('partName').textContent = name;
  $('partNote').textContent = '';
  $('generate').disabled = false;
  $('camResult').hidden = true;
  $('generateNote').textContent = '';
}

async function loadSamples() {
  try {
    const plates = await (await fetch('samples/plates.json')).json();
    $('sampleList').replaceChildren(...plates.map(p => new Option(p.name, p.file)));
  } catch {
    $('sampleList').hidden = $('sampleUse').hidden = $('sampleLabel').hidden = true;
  }
}

$('sampleUse').addEventListener('click', async () => {
  const option = $('sampleList').selectedOptions[0];
  if (!option) return;
  const sample = await (await fetch(`samples/${option.value}`)).json();
  usePart(sample.name, { part: sample.part });
});

$('generate').addEventListener('click', () => {
  if (!part) return;
  $('generate').disabled = true;
  $('generateNote').textContent = 'Working it out...';
  const { name, ...data } = part;
  camWorker.postMessage({ ...data, settings: readSettings(), machine });
});

function fillList(list, items) {
  list.replaceChildren(...items.map(text => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
}

camWorker.addEventListener('message', ({ data }) => {
  $('generate').disabled = false;
  $('generateNote').textContent = '';
  $('camResult').hidden = false;
  $('camRefused').hidden = data.ok;
  $('camDoneBox').hidden = !data.ok;
  $('camSkippedBox').hidden = true;
  $('camWarnings').hidden = true;
  if (!data.ok) {
    $('camRefused').textContent = data.message;
    clearJob();
    return;
  }
  const { lines, done, skipped, warnings, minutes, stock, thickness } = data.job;
  // eleven "5.5 mm hole" lines read better as one line with a count
  const counts = new Map();
  for (const d of done) counts.set(d, (counts.get(d) || 0) + 1);
  fillList($('camDone'), [...counts].map(([d, n]) => (n > 1 ? `${d} (${n})` : d)));
  $('camDoneTitle').textContent = `What gets cut (${done.length})`;
  if (skipped.length) {
    $('camSkippedBox').hidden = false;
    $('camSkippedTitle').textContent = `What's left for you (${skipped.length})`;
    fillList($('camSkipped'), skipped.map(k => `${k.what}: ${k.why}`));
  }
  if (warnings.length) {
    $('camWarnings').hidden = false;
    const ul = document.createElement('ul');
    fillList(ul, warnings);
    $('camWarnings').replaceChildren('Check these before you run it:', ul);
  }
  setJob(`${part.name}.nc`, lines, 'cam');
  $('cutTime').hidden = false;
  $('cutTime').textContent = `About ${Math.max(1, Math.round(minutes))} minutes of cutting. Stock: at least ${fmt(Math.ceil(stock.x))} x ${fmt(Math.ceil(stock.y))} mm, ${fmt(+thickness.toFixed(2))} mm thick.`;
});

$('helpButton').addEventListener('click', () => {
  $('help').showModal();
  $('help').scrollTop = 0; // Close is the only button, so focus would scroll it to the bottom
});

// ---------- inside Onshape ----------

const onshapeCtx = onshape.onshapeContext();

async function showOnshapeFiles() {
  $('onshapeNote').textContent = 'Looking for NC files in this document...';
  try {
    const files = await onshape.listNcFiles(onshapeCtx);
    $('onshapeSignIn').hidden = true;
    $('onshapeFiles').replaceChildren(...files.map(f => new Option(f.name, f.id)));
    $('onshapeFiles').hidden = $('onshapeLoad').hidden = !files.length;
    $('onshapeNote').textContent = files.length ? '' : 'No NC files here yet. Post from CAM Studio, then import the file into this document.';
  } catch (err) {
    if (err instanceof onshape.SignInNeeded) askToSignIn();
    else $('onshapeNote').textContent = err.message;
  }
}

async function showPartStudios() {
  if (onshapeCtx.panel) return showParts();
  $('partNote').textContent = 'Looking for Part Studios in this document...';
  try {
    const studios = await onshape.listPartStudios(onshapeCtx);
    $('partSignIn').hidden = true;
    $('partStudio').replaceChildren(...studios.map(t => new Option(t.name, t.id)));
    $('partStudio').hidden = !studios.length;
    // start on the Part Studio picked last time in this document
    const last = remember('studio');
    if (studios.some(t => t.id === last)) $('partStudio').value = last;
    if (studios.length) await showParts();
    else $('partNote').textContent = 'There are no Part Studios in this document.';
  } catch (err) {
    if (err instanceof onshape.SignInNeeded) askToSignIn();
    else $('partNote').textContent = err.message;
  }
}

// small per-document memory, so the same studio and part come up next time
function remember(what, value) {
  const key = `grblprep.${what}.${onshapeCtx.documentId}`;
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {}
}

// In the side panel the Part Studio is the one it's open next to, so there's no studio to pick.
const studioId = () => (onshapeCtx.panel ? onshapeCtx.elementId : $('partStudio').value);

// The dropdown is the list of parts. Whatever was picked last in this document loads straight
// away, so Make toolpath is ready when the page opens.
async function showParts() {
  $('partNote').textContent = 'Looking for parts...';
  try {
    const parts = await onshape.listParts(onshapeCtx, studioId());
    $('partList').replaceChildren(...parts.map(p => new Option(p.name, p.id)));
    $('partList').hidden = $('partUse').hidden = !parts.length;
    if (!parts.length) return void ($('partNote').textContent = 'That Part Studio has no parts.');
    $('partNote').textContent = onshapeCtx.panel ? 'Click a part in the Part Studio, or pick it here.' : '';
    const last = parts.find(p => p.id === remember('part'));
    if (lastSelection.length) useSelection(lastSelection);
    else if (last) readOnshapePart(last.id, last.name);
  } catch (err) {
    if (err instanceof onshape.SignInNeeded) askToSignIn();
    else $('partNote').textContent = err.message;
  }
}

// Only the newest request counts, so a slow read can't replace the part picked after it.
let loadedId = null, reads = 0;
async function readOnshapePart(id, name) {
  const mine = ++reads;
  remember('part', id);
  $('partList').value = id;
  $('partNote').textContent = `Reading ${name}...`;
  try {
    const data = await onshape.readPart(onshapeCtx, studioId(), id);
    if (mine !== reads) return;
    loadedId = id;
    usePart(name, data);
  } catch (err) {
    if (mine === reads) $('partNote').textContent = err.message;
  }
}

// Clicking a part, or any face or edge of it, in the Part Studio picks that part. Onshape sends
// the whole selection, oldest first. One that arrives before the parts are listed waits for them.
let lastSelection = [], picks = 0;
async function useSelection(selections) {
  lastSelection = selections;
  const newest = selections.at(-1);
  if (!newest || !$('partList').options.length) return;
  const mine = ++picks;
  try {
    const id = await onshape.partOfSelection(onshapeCtx, studioId(), newest);
    if (mine !== picks || id === loadedId) return;
    const option = [...$('partList').options].find(o => o.value === id);
    if (option) readOnshapePart(option.value, option.text);
    else $('partNote').textContent = 'That isn\'t a solid part. Click a part, or one of its faces.';
  } catch (err) {
    if (mine === picks) $('partNote').textContent = err.message;
  }
}

$('partStudio').addEventListener('change', () => {
  remember('studio', $('partStudio').value);
  showParts();
});
$('partList').addEventListener('change', () => remember('part', $('partList').value));

$('partUse').addEventListener('click', () => {
  const option = $('partList').selectedOptions[0];
  readOnshapePart(option.value, option.text);
});

if (onshapeCtx) {
  onshape.keepOnshapeAwake(onshapeCtx);
  $('onshapePick').hidden = false;
  $('partOnshape').hidden = false;
  if (onshapeCtx.panel) {
    document.body.classList.add('panel');
    // the samples are for trying it out, the panel is for your own parts
    $('sampleList').closest('.row').hidden = true;
    onshape.onSelection(onshapeCtx, useSelection);
  }
  if (!onshape.isSetUp()) {
    $('onshapeSignIn').disabled = $('partSignIn').disabled = true;
    $('onshapeNote').textContent = 'This copy of GRBL Prep isn\'t linked to Onshape yet, so drop the file in instead.';
    $('partNote').textContent = 'This copy of GRBL Prep isn\'t linked to Onshape yet, so only the sample plates work.';
  } else {
    connectOnshape();
  }
} else {
  $('partNote').textContent = 'Open GRBL Prep from an Onshape document to pick your own parts.';
}

// Connects without a click when it can: with the saved sign-in, or quietly through Onshape
// for anyone who has already allowed GRBL Prep. The button only shows up when that fails.
async function connectOnshape() {
  $('partSignIn').hidden = $('onshapeSignIn').hidden = true;
  $('partNote').textContent = $('onshapeNote').textContent = 'Connecting to Onshape...';
  if (!onshape.signedIn() && !(await onshape.signInQuietly())) return askToSignIn();
  showOnshapeFiles();
  showPartStudios();
}

function askToSignIn() {
  $('partSignIn').hidden = $('onshapeSignIn').hidden = false;
  $('partNote').textContent = $('onshapeNote').textContent = 'Click Sign in to Onshape once to let GRBL Prep read this document. After that it connects by itself.';
}

async function signInAndList() {
  try {
    await onshape.signIn();
    showOnshapeFiles();
    showPartStudios();
  } catch (err) {
    $('onshapeNote').textContent = $('partNote').textContent = err.message;
  }
}

$('onshapeSignIn').addEventListener('click', signInAndList);
$('partSignIn').addEventListener('click', signInAndList);

$('onshapeLoad').addEventListener('click', async () => {
  const option = $('onshapeFiles').selectedOptions[0];
  try {
    loadText(option.text, await onshape.readFile(onshapeCtx, option.value));
  } catch (err) {
    $('onshapeNote').textContent = err.message;
  }
});

$('saveOnshape').addEventListener('click', async () => {
  const name = `${baseName(job.name)}_grbl.nc`;
  try {
    await onshape.saveToDocument(onshapeCtx, name, job.lines);
    $('saveNote').textContent = `Saved ${name} as a new tab in this document.`;
  } catch (err) {
    $('saveNote').textContent = err.message;
  }
});

// ---------- start up ----------

fillMachineForm();
try {
  const last = JSON.parse(localStorage.getItem('grblprep.cam'));
  if (last && MATERIALS[last.material] && BITS[last.bit]) {
    $('material').value = last.material;
    $('bit').value = last.bit;
  }
} catch {}
fillSettings();
loadSamples();
showTab(true);
window.grblPrep = { loadText };
