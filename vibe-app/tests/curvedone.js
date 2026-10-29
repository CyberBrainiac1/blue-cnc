// One part from curved100.js, run by curvedrun.js in a worker thread: through the same path as the
// page (flat first, then 3D), in aluminium and wood, with each ball-nose finishing bit, every
// result checked by reading its G-code back.

import { parentPort, workerData } from 'node:worker_threads';
import './clipper.js';
import { parts } from './curved100.js';
import { meshToPart, toMesh, meshTop, measure } from './meshpart.js';
import { cutPart, PartError, CamError } from '../js/cutpart.js';
import { settingsFor } from '../js/cam.js';
import { TEAM_MACHINE as M } from '../js/convert.js';
import { check3d } from './check3d.js';

const SLOW = 10_000; // ms
const LONG = 200_000; // lines

export function tryCurved(index, only) {
  const p = parts()[index];
  const broken = p.name.startsWith('broken');
  const t0 = performance.now();
  const brep = broken || !p.tris.length ? null : meshToPart(p.tris);
  const brepMs = performance.now() - t0;
  const mesh = toMesh(p.tris);
  const flatIn = Float64Array.from(p.tris.flat(2));
  const before = measure(flatIn);
  // The page's way first. A part that comes out flat gets the 3D cut too, as if "Cut it in 3D" were ticked.
  const runs = [];
  for (const material of ['aluminium', 'wood']) {
    let flat = false;
    for (const ball of ['eighthBall', 'quarterBall']) {
      if (only && !`${material} ${ball}`.includes(only)) continue;
      const data = { part: brep, mesh, settings: settingsFor(material, 'quarter'), finish: settingsFor(material, ball), machine: M };
      if (!flat) {
        const r = one(p, data, material, ball, flatIn, before);
        runs.push(r);
        if (r.outcome !== 'flat') continue;
        flat = true;
      }
      runs.push({ ...one(p, { ...data, cut3d: true }, material, ball, flatIn, before), ticked: true });
    }
  }
  return { index, name: p.name, group: p.group, triangles: p.tris.length, brepMs, runs };
}

function one(p, data, material, ball, flatIn, before) {
  const out = { material, ball, problems: [], flags: [] };
  const t0 = performance.now();
  let res;
  try {
    res = cutPart(structuredClone(data));
  } catch (e) {
    out.ms = performance.now() - t0;
    const clear = (e instanceof PartError || e instanceof CamError) && e.message.length > 15 && e.message.length < 400 && !/undefined|NaN|\[object/.test(e.message);
    out.outcome = 'refused';
    out.message = e.message;
    if (!clear) out.problems.push(`crashed: ${e.stack || e}`);
    else if (p.expect === 'cut') out.problems.push(`turned down: ${e.message}`);
    return out;
  }
  out.ms = performance.now() - t0;
  const { kind, job } = res;
  out.outcome = kind;
  out.lines = job.lines.length;
  out.minutes = job.minutes;
  out.warnings = job.warnings;
  out.skipped = job.skipped.map(s => s.what);
  if (p.expect === 'refuse') out.problems.push('should have been turned down, but made G-code');
  const text = [...job.warnings, ...job.done, ...job.skipped.flatMap(s => [s.what, s.why])].join(' | ');
  if (/undefined|NaN|\[object|Infinity/.test(text)) out.problems.push(`odd text: ${text}`);
  if (!(job.minutes > 0 && isFinite(job.minutes))) out.problems.push(`cut time ${job.minutes}`);
  if (job.minutes > 600) out.flags.push(`cut time ${Math.round(job.minutes)} min`);
  if (out.ms > SLOW) out.flags.push(`took ${(out.ms / 1000).toFixed(1)} s`);
  if (out.lines > LONG) out.flags.push(`${out.lines} lines`);

  // every move inside the stock
  let x = 0, y = 0, outside = 0;
  for (const l of job.lines) {
    const mx = l.match(/X(-?[\d.]+)/), my = l.match(/Y(-?[\d.]+)/);
    if (mx) x = +mx[1];
    if (my) y = +my[1];
    if ((mx || my) && (x < -1e-3 || y < -1e-3 || x > job.stock.x + 1e-3 || y > job.stock.y + 1e-3)) outside++;
  }
  if (outside) out.problems.push(`${outside} moves outside the ${job.stock.x} x ${job.stock.y} stock`);

  if (kind === 'flat') {
    // only checkable against the drawing when the reader kept it the way it was drawn
    let minX = Infinity, minY = Infinity, maxZ = -Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity;
    for (let k = 0; k < flatIn.length; k += 3) {
      minX = Math.min(minX, flatIn[k]); minY = Math.min(minY, flatIn[k + 1]); minZ = Math.min(minZ, flatIn[k + 2]);
      maxX = Math.max(maxX, flatIn[k]); maxY = Math.max(maxY, flatIn[k + 1]); maxZ = Math.max(maxZ, flatIn[k + 2]);
    }
    const s = data.settings;
    const asDrawn = Math.abs(res.thickness - (maxZ - minZ)) < 0.01
      && Math.abs(job.stock.x - (maxX - minX) - 2 * (s.diameter + 2)) < 0.01 && Math.abs(job.stock.y - (maxY - minY) - 2 * (s.diameter + 2)) < 0.01;
    if (!asDrawn || job.warnings.some(w => /turned|upside down|other side/.test(w))) { out.flags.push('flat, not as drawn: surface not checked'); return out; }
    const fake = { ...job, settings: s, finish: s, margin: s.diameter + 2, solid: { height: res.thickness }, allowance: 0, floor: -res.thickness };
    const found = check3d(fake, { height: meshTop(flatIn), corner: [minX, minY, maxZ] }, M, { flat: true }).problems;
    // Known: the flat reader takes a curved face under 0.5 mm² seen from above for an upright
    // wall, so a flat cut can nick a tiny sloped blend. Parts that have them say so.
    for (const f of found) (p.flatNicks && /^gouge/.test(f) ? out.flags : out.problems).push(f);
    return out;
  }

  // the part was only moved and turned on its way in, never stretched or mirrored (an open mesh
  // has no volume to go by)
  const after = measure(job.solid.tris);
  const closed = !p.name.startsWith('broken');
  if (Math.abs(after.area - before.area) > 1e-6 * before.area || (closed && Math.abs(after.volume - before.volume) > 1e-6 * Math.abs(before.volume) + 1e-6)) {
    out.problems.push(`the part changed shape on the way in: area ${before.area} to ${after.area}, volume ${before.volume} to ${after.volume}`);
  }
  const undercuts = out.skipped.filter(w => w.startsWith('undercut'));
  if (p.undercut === true && !undercuts.length) out.problems.push('has an undercut, but none is listed');
  if (p.undercut === false && undercuts.length) out.problems.push(`no undercut, but lists ${undercuts.join('; ')}`);
  const r = check3d(job, { height: meshTop(job.solid.tris), corner: [0, 0, 0] }, M);
  out.problems.push(...r.problems);
  out.left = r.left;
  out.bite = r.biggestBite.bite;
  if (r.biggestBite.bite > job.allowance + 0.35) out.problems.push(`the ball takes ${r.biggestBite.bite.toFixed(2)} mm in one go`);
  if (r.left.gentle.count > 100 && r.left.gentle.max > 0.1) out.flags.push(`leaves up to ${r.left.gentle.max.toFixed(2)} mm on gentle parts`);
  return out;
}

if (parentPort) parentPort.postMessage(tryCurved(workerData.index, workerData.only));
