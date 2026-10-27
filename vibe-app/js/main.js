import { convert, splitByTool, ConvertError, TEAM_MACHINE, fmt } from './convert.js';
import { toolpath } from './toolpath.js';
import { drawPath } from './preview.js';
import { GrblSender, STATES } from './grbl.js';
import { serialWorks, openSerial } from './serial.js';
import { MockGrbl } from './mockgrbl.js';
import * as onshape from './onshape.js';
import { MATERIALS, BITS, settingsFor } from './cam.js';

const $ = id => document.getElementById(id);
const useMock = new URLSearchParams(location.search).has('mock');

let job = null;       // { name, source, lines, path, parts, kind }
let link = null;      // the open serial port (or the mock)
let sender = null;
let machineState = null;
let poll = null;
let pausedByUs = false;

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
  document.querySelectorAll('#previewPanel .step, #sendPanel .step').forEach((el, i) => { el.textContent = (cam ? 4 : 2) + i; });
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
  updateButtons();
}

function clearJob() {
  job = null;
  $('download').disabled = true;
  $('downloadParts').hidden = true;
  $('saveOnshape').hidden = true;
  $('cutTime').hidden = true;
  drawAll(null);
  updateButtons();
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

// ---------- talking to GRBL ----------

function say(text, kind = 'info') {
  const p = document.createElement('p');
  p.className = `msg ${kind}`;
  p.textContent = text;
  $('machineMessages').prepend(p);
  while ($('machineMessages').children.length > 6) $('machineMessages').lastChild.remove();
}

function updateButtons() {
  const connected = !!link;
  const idle = machineState === 'Idle';
  const running = sender?.running;
  $('connect').textContent = connected ? 'Disconnect' : 'Connect to GRBL';
  $('home').disabled = !connected || running || !(idle || machineState === 'Alarm');
  $('start').disabled = !connected || running || !idle || !job;
  $('pause').disabled = !connected || machineState !== 'Run';
  $('resume').disabled = !connected || machineState !== 'Hold';
  $('stop').disabled = !connected;
}

// colours the status pill; states not listed stay grey
const PILL = { Idle: 'ready', Run: 'running', Jog: 'running', Home: 'running', Hold: 'paused', Door: 'paused', Alarm: 'alarm' };

function showState(s) {
  const was = machineState;
  machineState = s.state;
  $('state').textContent = STATES[s.state] || s.state;
  $('state').dataset.state = PILL[s.state] || '';
  const p = s.WPos || s.MPos;
  if (p) {
    // GRBL sends machine position plus a work offset every so often
    const wco = s.WCO || showState.wco || { x: 0, y: 0, z: 0 };
    if (s.WCO) showState.wco = s.WCO;
    const w = s.WPos ? p : { x: p.x - wco.x, y: p.y - wco.y, z: p.z - wco.z };
    $('where').textContent = `X${w.x.toFixed(2)} Y${w.y.toFixed(2)} Z${w.z.toFixed(2)}`;
  }
  // a hold we didn't ask for while the job runs means GRBL reached an M0, which is a tool change
  if (s.state === 'Hold' && was === 'Run' && sender?.running && !sender.held && !pausedByUs) {
    say('Paused for a tool change. Swap the end mill and re-zero Z, then click Resume.');
  }
  if (s.state !== 'Hold') pausedByUs = false;
  updateButtons();
}

function makeSender(write) {
  return new GrblSender(write, {
    ready: line => { say(`Connected: ${line}`); updateButtons(); },
    status: showState,
    progress: (acked, total) => {
      $('progress').max = total || 1;
      $('progress').value = acked;
      $('progressText').textContent = total ? `${acked} of ${total} lines done` : '';
    },
    done: () => say('The job is finished. Turn off the VFD and the pump when the spindle stops.'),
    error: (code, text, line) => say(`GRBL error ${code} at line ${line} of the sent file: ${text} The job is paused. Click Resume to skip that line and carry on, or STOP.`, 'bad'),
    alarm: (code, text) => { say(`Alarm ${code}: ${text}`, 'bad'); updateButtons(); },
    message: line => {
      if (line.includes("'$H'|'$X' to unlock")) say('GRBL is locked until the machine is homed. Click Home.');
      else if (line.startsWith('[MSG:')) say(line.slice(5, -1));
    },
  });
}

async function connect() {
  if (link) {
    clearInterval(poll);
    await link.close();
    return;
  }
  const onClose = () => {
    clearInterval(poll);
    link = null;
    sender = null;
    machineState = null;
    $('state').textContent = 'Not connected';
    $('state').dataset.state = '';
    $('where').textContent = '';
    updateButtons();
  };
  if (useMock) {
    let mock;
    sender = makeSender(data => mock.write(data));
    mock = new MockGrbl({ msPerLine: 20, reply: text => sender.receive(text) });
    link = { write: data => mock.write(data), close: async () => onClose() };
  } else {
    try {
      let s;
      link = await openSerial(text => s.receive(text), onClose);
      s = sender = makeSender(data => link.write(data));
    } catch (err) {
      if (err.name !== 'NotFoundError') say(`Couldn't open the port: ${err.message}. Close gSender or anything else using it and try again.`, 'bad');
      return;
    }
  }
  poll = setInterval(() => sender?.status(), 250);
  updateButtons();
}

$('connect').addEventListener('click', connect);
$('home').addEventListener('click', () => { sender.home(); say('Homing. Keep clear of the machine.'); });
$('pause').addEventListener('click', () => { pausedByUs = true; sender.pause(); });
$('resume').addEventListener('click', () => sender.resume());
$('stop').addEventListener('click', () => {
  sender.stop();
  say('Stopped. GRBL was reset, so home the machine before the next job.', 'bad');
});

$('start').addEventListener('click', () => {
  $('checklist').querySelectorAll('input').forEach(box => { box.checked = false; });
  $('checklist').showModal();
});

// The form only submits once every box is ticked, because they're all required.
$('checklist').querySelector('form').addEventListener('submit', e => {
  if (e.submitter?.value !== 'go') return;
  try {
    sender.start(job.lines);
    say(`Started ${job.name}.`);
  } catch (err) {
    say(err.message, 'bad');
  }
  updateButtons();
});

$('helpButton').addEventListener('click', () => {
  $('help').showModal();
  $('help').scrollTop = 0; // Close is the only button, so focus would scroll it to the bottom
});

// ---------- inside Onshape ----------

const onshapeCtx = onshape.onshapeContext();
const inFrame = window.top !== window;

async function showOnshapeFiles() {
  $('onshapeNote').textContent = 'Looking for NC files in this document...';
  try {
    const files = await onshape.listNcFiles(onshapeCtx);
    $('onshapeSignIn').hidden = true;
    $('onshapeFiles').replaceChildren(...files.map(f => new Option(f.name, f.id)));
    $('onshapeFiles').hidden = $('onshapeLoad').hidden = !files.length;
    $('onshapeNote').textContent = files.length ? '' : 'No NC files here yet. Post from CAM Studio, then import the file into this document.';
  } catch (err) {
    $('onshapeNote').textContent = err.message;
  }
}

async function showPartStudios() {
  $('partNote').textContent = 'Looking for Part Studios in this document...';
  try {
    const studios = await onshape.listPartStudios(onshapeCtx);
    $('partSignIn').hidden = true;
    $('partStudio').replaceChildren(...studios.map(t => new Option(t.name, t.id)));
    $('partStudio').hidden = !studios.length;
    if (studios.length) await showParts();
    else $('partNote').textContent = 'There are no Part Studios in this document.';
  } catch (err) {
    $('partNote').textContent = err.message;
  }
}

async function showParts() {
  $('partNote').textContent = 'Looking for parts...';
  try {
    const parts = await onshape.listParts(onshapeCtx, $('partStudio').value);
    $('partList').replaceChildren(...parts.map(p => new Option(p.name, p.id)));
    $('partList').hidden = $('partUse').hidden = !parts.length;
    $('partNote').textContent = parts.length ? '' : 'That Part Studio has no parts.';
  } catch (err) {
    $('partNote').textContent = err.message;
  }
}

$('partStudio').addEventListener('change', showParts);

$('partUse').addEventListener('click', async () => {
  const option = $('partList').selectedOptions[0];
  $('partNote').textContent = `Reading ${option.text}...`;
  try {
    usePart(option.text, await onshape.readPart(onshapeCtx, $('partStudio').value, option.value));
  } catch (err) {
    $('partNote').textContent = err.message;
  }
});

if (onshapeCtx) {
  onshape.keepOnshapeAwake(onshapeCtx);
  $('onshapePick').hidden = false;
  $('partOnshape').hidden = false;
  if (!onshape.isSetUp()) {
    $('onshapeSignIn').disabled = $('partSignIn').disabled = true;
    $('onshapeNote').textContent = 'This copy of GRBL Prep isn\'t linked to Onshape yet, so drop the file in instead.';
    $('partNote').textContent = 'This copy of GRBL Prep isn\'t linked to Onshape yet, so only the sample plates work.';
  } else if (onshape.signedIn()) {
    showOnshapeFiles();
    showPartStudios();
  }
} else {
  $('partNote').textContent = 'Open GRBL Prep from an Onshape document to pick your own parts.';
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

// Browsers don't let pages inside another site's frame use USB, so sending happens in a tab of its own.
$('openTab').addEventListener('click', () => {
  if (job) {
    try { localStorage.setItem('grblprep.handoff', JSON.stringify({ name: job.name, source: job.source })); } catch {}
  }
  window.open(new URL('./?handoff', location.href), '_blank');
});

function pickUpHandoff() {
  if (!new URLSearchParams(location.search).has('handoff')) return;
  try {
    const h = JSON.parse(localStorage.getItem('grblprep.handoff'));
    localStorage.removeItem('grblprep.handoff');
    if (h) {
      showTab(false);
      loadText(h.name, h.source);
    }
  } catch {}
}

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
const canSend = (serialWorks() && !inFrame) || useMock;
$('noSerial').hidden = canSend || inFrame;
$('inFrame').hidden = !inFrame || useMock;
$('connect').disabled = !canSend;
pickUpHandoff();
updateButtons();
window.grblPrep = { loadText };
