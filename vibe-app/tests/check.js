// Checks a CAM job the hard way: reads its G-code back, cuts a height map with the bit, and looks
// for anything that would hurt the part, the bit or the machine. Returns a list of problems.

import './clipper.js';
import { toolpath } from '../js/toolpath.js';
import { convert } from '../js/convert.js';
import { closeGaps } from '../js/part.js';
import { toMm, offset, union, intersection, difference, pieces, bounds, perimeter } from '../js/geom.js';

const ALLOWED = new Set(['G0', 'G1', 'G2', 'G3', 'G4', 'G17', 'G21', 'G90', 'G94', 'M3', 'M5', 'M30']);
const NUMBER = /^-?\d+(\.\d+)?$/;

export function checkJob(job, given, machine) {
  const plate = job.plate || given; // the CAM may have turned it to fit
  const problems = [];
  const s = job.settings;
  const r = s.diameter / 2;
  const zThrough = -plate.thickness - s.overcut;
  const tabTop = -plate.thickness + s.tabHeight; // tabs stand up from the bottom of the part
  const say = msg => { if (problems.length < 30) problems.push(msg); };

  // ---- every line is plain GRBL 1.1 with real numbers
  let feedTop = 0;
  for (const raw of job.lines) {
    const code = raw.replace(/\([^)]*\)/g, '').trim();
    if (!code) continue;
    if (/[;#[\]]|NaN|Infinity|undefined/.test(code)) { say(`odd text in "${raw}"`); continue; }
    for (const word of code.split(/\s+/)) {
      const letter = word[0], num = word.slice(1);
      if (letter === 'G' || letter === 'M') {
        if (!ALLOWED.has(word)) say(`code ${word} isn't on the GRBL list`);
      } else if ('XYZIJFSP'.includes(letter)) {
        if (!NUMBER.test(num)) say(`bad number in "${raw}"`);
        if (letter === 'F') feedTop = Math.max(feedTop, +num);
        if (letter === 'S' && +num > machine.spindleMax) say(`spindle S${num} is over the top speed`);
      } else {
        say(`unknown word ${word}`);
      }
    }
  }
  if (feedTop > Math.max(machine.maxFeed.x, machine.maxFeed.y)) say(`feed F${feedTop} is over the machine's top speed`);
  try {
    const back = convert(job.lines.join('\n'), machine);
    if (back.changes.length || back.warnings.length) say(`the converter wanted to change it: ${[...back.changes, ...back.warnings].slice(0, 2).join('; ')}`);
  } catch (e) {
    say(`the converter refused it: ${e.message}`);
  }

  // ---- where the bit goes
  const segs = toolpath(job.lines).segs;
  let lowest = Infinity;
  for (const seg of segs) {
    const { from: a, to: b } = seg;
    for (const p of [a, b]) {
      lowest = Math.min(lowest, p.z);
      if (p.x < -1e-6 || p.y < -1e-6 || p.x > machine.travel.x || p.y > machine.travel.y) { say(`move to X${p.x} Y${p.y} is off the machine`); break; }
    }
    const xy = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg.rapid) {
      if (xy > 1e-6 && (a.z < machine.safeZ - 1e-6 || b.z < machine.safeZ - 1e-6)) say(`rapid sideways at Z${Math.min(a.z, b.z)}, below safe Z`);
      if (b.z < -1e-6) say(`rapid down to Z${b.z}, into the stock`);
    }
  }
  if (lowest < zThrough - 0.001) say(`goes down to Z${lowest}, below the stock bottom plus overcut (${zThrough})`);
  if (-lowest > machine.travel.z - machine.safeZ) say('deeper than the Z travel');

  // ---- cut a height map and watch how the bit gets into the material
  const res = Math.max(0.1, Math.min(0.2, Math.sqrt(job.stock.x * job.stock.y / 2e6)));
  const map = new HeightMap(job.stock.x + 4, job.stock.y + 4, res, -2);
  const steepest = Math.tan((s.rampAngle + 0.5) * Math.PI / 180);
  const tabSlack = 1.5 * s.tabHeight + s.doc + 0.05;
  let plunges = 0;
  for (const seg of segs) {
    if (seg.rapid || Math.min(seg.from.z, seg.to.z) >= 0) continue;
    for (const [a, b] of split(seg.from, seg.to, 1)) {
      // a hair under the real radius, so offset corners rounded off by 0.01 mm don't count as gouges
      const bite = map.cut(a, b, r - 0.03, r - 0.15);
      const drop = a.z - b.z;
      if (drop <= 1e-9 || bite < 0.01) continue;
      const run = Math.hypot(b.x - a.x, b.y - a.y);
      const slope = run < 1e-9 ? Infinity : drop / run;
      if (slope > steepest && !(bite <= tabSlack && slope <= 1.01)) {
        if (plunges++ < 3) say(`steep entry into material at X${fmt(b.x)} Y${fmt(b.y)} Z${fmt(b.z)}: ${run < 1e-9 ? 'straight down' : `${fmt(Math.atan(slope) * 180 / Math.PI)} degrees`}, ${fmt(bite)} mm deep`);
      }
    }
  }

  // ---- nothing cut into the part: compare the cut heights with the part's own faces
  const part = new Float32Array(map.z.length).fill(-Infinity);
  // Material at each height, the way the reader counts it: inside the footprint, with hairline
  // slivers between faces closed up or dropped.
  for (const h of [...new Set(plate.faces.map(f => f.h))]) {
    const solid = intersection(closeGaps(union(plate.faces.filter(f => f.h >= h - 0.001).flatMap(f => f.region))), plate.footprint);
    map.fill(solid, job.margin, k => { part[k] = Math.max(part[k], h); });
  }
  let gouged = 0, worst = 0, where = null;
  for (let k = 0; k < part.length; k++) {
    const under = part[k] - map.z[k];
    if (under > 0.02) {
      gouged++;
      if (under > worst) { worst = under; where = map.centre(k); }
    }
  }
  if (gouged) say(`gouge: ${gouged} spots cut up to ${fmt(worst)} mm into the part, worst near X${fmt(where[0] - job.margin)} Y${fmt(where[1] - job.margin)}`);

  // ---- everything is either cut or listed as skipped
  const bodies = pieces(plate.footprint);
  const holes = bodies.reduce((n, b) => n + b.holes.length, 0);
  const said = [...job.done, ...job.skipped.map(k => k.what)].filter(t => / hole$| cutout$/.test(t)).length;
  if (said !== holes) say(`the part has ${holes} holes but the job lists ${said}`);
  for (const k of job.skipped) if (!k.why || k.why.length < 10) say(`"${k.what}" was skipped with no reason`);

  // outline: cut to the tab tops all the way round the bit's path, and right through except at
  // the tabs. Tab length is measured just outside the part, where the tab material really is.
  const path = sampleLoop(offset(bodies.map(b => b.outer), r), 0.5);
  const depth = ([x, y]) => map.at(x + job.margin, y + job.margin);
  const high = path.filter(p => depth(p) > tabTop + 0.03);
  if (high.length > path.length * 0.01) {
    say(`outline not cut down to the tab tops in ${high.length} of ${path.length} spots, first near X${fmt(high[0][0])} Y${fmt(high[0][1])}`);
  }
  const edge = sampleLoop(offset(bodies.map(b => b.outer), 0.4), 0.25).map(depth).filter(z => z <= tabTop + 0.03);
  if (edge.length) {
    const onTab = edge.filter(z => z > zThrough + 0.03).length / edge.length;
    if (onTab < 0.003) say('no tabs on the outline');
    // (a part only a few bits across is mostly tab, and that's fine)
    const around = offset(bodies.map(b => b.outer), r).reduce((a, p) => a + perimeter(p), 0);
    if (onTab > 0.7 && around > 40) say(`tabs cover ${fmt(onTab * 100)}% of the outline`);
  }

  // through holes that were cut go all the way down
  for (const body of bodies) {
    for (const hole of body.holes) {
      // where the bit's centre can go in this hole without touching the part (as the CAM works it out)
      const inner = closeGaps(difference([hole.slice().reverse()], offset(plate.footprint, r)));
      const pts = sampleLoop(inner, 0.5);
      if (!pts.length) continue;
      const deep = pts.map(([x, y]) => map.at(x + job.margin, y + job.margin));
      const stuck = deep.filter(z => z > tabTop + 0.03).length;
      const b = bounds([hole]);
      const listed = job.skipped.some(k => k.where && Math.abs(k.where.minX - b.minX) < 0.01 && Math.abs(k.where.minY - b.minY) < 0.01);
      if (!listed && stuck > pts.length * 0.05) say(`hole near X${fmt(b.minX)} Y${fmt(b.minY)} isn't cut through and isn't listed as skipped`);
    }
  }

  // pocket floors the bit can reach are cut down to the floor
  const quietMiss = !job.warnings.some(w => /stays uncut/.test(w)) && !job.skipped.some(k => /pocket|low area/.test(k.what));
  for (const f of plate.faces) {
    if (f.h > -0.001 || f.odd) continue;
    const reach = offset(f.region, -(r + 0.15));
    const pts = sampleArea(reach, 1500);
    const high = pts.filter(([x, y]) => map.at(x + job.margin, y + job.margin) > f.h + 0.03);
    if (high.length && quietMiss) say(`pocket floor at ${fmt(f.h)} left uncut in ${high.length} of ${pts.length} spots, with no warning`);
  }
  return problems;
}

const fmt = v => String(+(+v).toFixed(3));

// Splits a move into pieces no longer than `step` across, with z following along.
function split(a, b, step) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  const out = [];
  let prev = a;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const p = i === n ? b : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    out.push([prev, p]);
    prev = p;
  }
  return out;
}

function sampleLoop(paths, step) {
  const out = [];
  for (const path of paths) {
    const pts = toMm(path);
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    });
  }
  return out;
}

// About `count` points spread over the inside of some regions.
function sampleArea(paths, count) {
  if (!paths.length) return [];
  const b = bounds(paths);
  const step = Math.max(0.3, Math.sqrt((b.maxX - b.minX) * (b.maxY - b.minY) / count));
  const C = globalThis.ClipperLib.Clipper;
  const out = [];
  for (let x = b.minX + step / 2; x < b.maxX; x += step) {
    for (let y = b.minY + step / 2; y < b.maxY; y += step) {
      const pt = { X: Math.round(x * 1000), Y: Math.round(y * 1000) };
      let n = 0;
      for (const p of paths) if (C.PointInPolygon(pt, p) === 1) n++;
      if (n % 2) out.push([x, y]);
    }
  }
  return out;
}

// The top of the stock as a grid of heights, starting flat at Z0.
class HeightMap {
  constructor(w, h, res, origin) {
    this.res = res;
    this.o = origin;
    this.nx = Math.ceil(w / res);
    this.ny = Math.ceil(h / res);
    this.z = new Float32Array(this.nx * this.ny);
  }

  centre(k) {
    return [this.o + (k % this.nx + 0.5) * this.res, this.o + (Math.floor(k / this.nx) + 0.5) * this.res];
  }

  // Calls back with every cell whose centre is inside the regions (Clipper paths in µm, moved by `shift` mm).
  fill(paths, shift, each) {
    const { res, o, nx, ny } = this;
    const edges = [];
    for (const path of paths) {
      const pts = toMm(path).map(([x, y]) => [x + shift, y + shift]);
      pts.forEach((a, i) => edges.push([a, pts[(i + 1) % pts.length]]));
    }
    const b = bounds(paths);
    const j0 = Math.max(0, Math.floor((b.minY + shift - o) / res)), j1 = Math.min(ny - 1, Math.ceil((b.maxY + shift - o) / res));
    for (let j = j0; j <= j1; j++) {
      const y = o + (j + 0.5) * res;
      const xs = [];
      for (const [a, c] of edges) {
        if ((a[1] <= y) !== (c[1] <= y)) xs.push(a[0] + (y - a[1]) / (c[1] - a[1]) * (c[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let n = 0; n + 1 < xs.length; n += 2) {
        const i0 = Math.max(0, Math.ceil((xs[n] - o) / res - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[n + 1] - o) / res - 0.5));
        for (let i = i0; i <= i1; i++) each(j * nx + i);
      }
    }
  }

  at(x, y) {
    const i = Math.round((x - this.o) / this.res - 0.5), j = Math.round((y - this.o) / this.res - 0.5);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return 0;
    return this.z[j * this.nx + i];
  }

  // Lowers every cell the bit's flat bottom passes over on a straight move, and returns the most
  // material it took off any one cell within `inner` of the bit's centre. (Right at the rim, a ring
  // that lines up with a wall cut on the pass before can look like a bite from grid rounding.)
  cut(a, b, r, inner = r) {
    const { res, o, nx, ny } = this;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r - o) / res));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x) + r - o) / res));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - r - o) / res));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(a.y, b.y) + r - o) / res));
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let bite = 0;
    for (let j = j0; j <= j1; j++) {
      const cy = o + (j + 0.5) * res;
      for (let i = i0; i <= i1; i++) {
        const cx = o + (i + 0.5) * res;
        let t0, t1;
        if (len < 1e-9) {
          if (Math.hypot(cx - a.x, cy - a.y) > r) continue;
          t0 = 0; t1 = 1;
        } else {
          const t = ((cx - a.x) * dx + (cy - a.y) * dy) / (len * len);
          const d = Math.abs((cx - a.x) * dy - (cy - a.y) * dx) / len;
          if (d > r) continue;
          const w = Math.sqrt(r * r - d * d) / len;
          t0 = Math.max(0, t - w); t1 = Math.min(1, t + w);
          if (t0 > t1) continue;
        }
        const low = Math.min(a.z + (b.z - a.z) * t0, a.z + (b.z - a.z) * t1);
        const k = j * nx + i;
        if (this.z[k] > low) {
          if (inner >= r || distToSeg(cx, cy, a, b) <= inner) bite = Math.max(bite, this.z[k] - low);
          this.z[k] = low;
        }
      }
    }
    return bite;
  }
}

function distToSeg(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}

export { HeightMap };
