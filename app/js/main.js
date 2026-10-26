import { convert, splitByTool, ConvertError, TEAM_MACHINE, fmt } from './convert.js';
import { toolpath } from './toolpath.js';
import { drawPath } from './preview.js';
import { GrblSender, STATES } from './grbl.js';
import { serialWorks, openSerial } from './serial.js';
import { MockGrbl } from './mockgrbl.js';
import * as onshape from './onshape.js';

const $ = id => document.getElementById(id);
const useMock = new URLSearchParams(location.search).has('mock');

let job = null;       // { name, lines, path }
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

$('machine').addEventListener('change', () => {
  readMachineForm();
  if (job) loadText(job.name, job.source);
});

$('machineReset').addEventListener('click', () => {
  machine = structuredClone(TEAM_MACHINE);
  fillMachineForm();
  readMachineForm();
  if (job) loadText(job.name, job.source);
});

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
    $('download').disabled = true;
    $('downloadParts').hidden = true;
    drawAll(null);
    updateButtons();
    return;
  }

  const path = toolpath(result.lines);
  job = { name, source, lines: result.lines, path, parts: splitByTool(result.lines) };

  $('changesBox').hidden = false;
  $('changesTitle').textContent = result.changes.length ? `What changed (${result.changes.length})` : 'Nothing needed changing';
  result.changes.forEach(c => $('changes').append(listItem(c)));
  if (result.warnings.length) {
    $('warnings').hidden = false;
    const ul = document.createElement('ul');
    result.warnings.forEach(w => ul.append(listItem(w)));
    $('warnings').replaceChildren('Check these before you run it:', ul);
  }
  $('download').disabled = false;
  $('saveOnshape').hidden = !(onshapeCtx && onshape.signedIn());
  $('downloadParts').hidden = job.parts.length < 2;
  $('downloadParts').textContent = `Download one file per tool (${job.parts.length} files)`;
  drawAll(path);
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
  return name.replace(/\.[^.]+$/, '');
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

function showState(s) {
  const was = machineState;
  machineState = s.state;
  $('state').textContent = STATES[s.state] || s.state;
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

$('helpButton').addEventListener('click', () => $('help').showModal());

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

if (onshapeCtx) {
  onshape.keepOnshapeAwake(onshapeCtx);
  $('onshapePick').hidden = false;
  if (!onshape.isSetUp()) {
    $('onshapeSignIn').disabled = true;
    $('onshapeNote').textContent = 'This copy of GRBL Prep isn\'t linked to Onshape yet, so drop the file in instead.';
  } else if (onshape.signedIn()) {
    showOnshapeFiles();
  }
}

$('onshapeSignIn').addEventListener('click', async () => {
  try {
    await onshape.signIn();
    showOnshapeFiles();
  } catch (err) {
    $('onshapeNote').textContent = err.message;
  }
});

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
    $('onshapeNote').textContent = `Saved ${name} as a new tab in this document.`;
  } catch (err) {
    $('onshapeNote').textContent = err.message;
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
    if (h) loadText(h.name, h.source);
  } catch {}
}

// ---------- start up ----------

fillMachineForm();
const canSend = (serialWorks() && !inFrame) || useMock;
$('noSerial').hidden = canSend || inFrame;
$('inFrame').hidden = !inFrame || useMock;
$('connect').disabled = !canSend;
pickUpHandoff();
updateButtons();
window.grblPrep = { loadText };
