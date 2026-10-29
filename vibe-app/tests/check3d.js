// Checks a 3D job the hard way: reads its G-code back, runs both bits through a height map of the
// stock, and compares every cut with the part's exact surface. Returns a list of problems, and
// some numbers the tests look at.

import './clipper.js';
import { convert, splitByTool } from '../js/convert.js';

const ALLOWED = new Set(['G0', 'G1', 'G4', 'G17', 'G21', 'G90', 'G94', 'M0', 'M3', 'M5', 'M30']);
const NUMBER = /^-?\d+(\.\d+)?$/;
const fmt = v => String(+(+v).toFixed(3));

// `height(x, y)` is the part's top in the test's own coordinates, and `corner` the front left top
// corner of the part there, which the CAM moves to X0 Y0 Z0.
export function check3d(job, { height, corner }, machine) {
  const problems = [];
  const say = msg => { if (problems.length < 30) problems.push(msg); };
  const rough = job.settings, finish = job.finish;
  const part = (x, y) => height(x - job.margin + corner[0], y - job.margin + corner[1]) - corner[2];
  const H = job.solid.height;

  // ---- plain GRBL, feeds and speeds inside the limits
  let feedTop = 0;
  for (const raw of job.lines) {
    const code = raw.replace(/\([^)]*\)/g, '').trim();
    if (!code) continue;
    if (/[;#[\]]|NaN|Infinity|undefined/.test(code)) { say(`odd text in "${raw}"`); continue; }
    for (const word of code.split(/\s+/)) {
      const letter = word[0], num = word.slice(1);
      if (letter === 'G' || letter === 'M') {
        if (!ALLOWED.has(word)) say(`code ${word} isn't on the GRBL list`);
      } else if ('XYZFSP'.includes(letter)) {
        if (!NUMBER.test(num)) say(`bad number in "${raw}"`);
        if (letter === 'F') feedTop = Math.max(feedTop, +num);
        if (letter === 'S' && +num > machine.spindleMax) say(`spindle S${num} is over the top speed`);
      } else {
        say(`unknown word ${word}`);
      }
    }
  }
  if (feedTop > Math.max(machine.maxFeed.x, machine.maxFeed.y)) say(`feed F${feedTop} is over the machine's top speed`);
  const back = convert(job.lines.join('\n'), machine);
  if (back.changes.length || back.warnings.length) say(`the converter wanted to change it: ${[...back.changes, ...back.warnings].map(c => c.text || c).slice(0, 2).join('; ')}`);

  // ---- the tool change: spindle off, up, which bit and re-zero Z, pause, up again, spindle on
  const stops = job.lines.flatMap((l, i) => (l === 'M0' ? [i] : []));
  if (stops.length !== 1) say(`${stops.length} pauses, not 1`);
  const stop = stops[0];
  if (stop !== undefined) {
    const before = job.lines.slice(stop - 3, stop), after = job.lines.slice(stop + 1, stop + 3);
    if (before[1] !== 'M5') say(`no M5 before the pause: ${before.join(' | ')}`);
    if (!/^\(Change to tool 2 .*ball nose, re-zero Z only on the uncut stock near X0 Y0, then resume\)$/.test(job.lines[stop - 1])) say(`the pause doesn't say which bit: ${job.lines[stop - 1]}`);
    if (after[0] !== `G0 Z${machine.safeZ}` || !/^M3 S\d+$/.test(after[1])) say(`no lift and spindle start after the pause: ${after.join(' | ')}`);
    // the tool changes at safe Z: the last move before it ends up there
    const lastZ = job.lines.slice(0, stop).reverse().find(l => /\bZ-?[\d.]/.test(l.replace(/\([^)]*\)/g, '')));
    if (!lastZ || +lastZ.match(/Z(-?[\d.]+)/)[1] < machine.safeZ - 1e-6) say(`the bit isn't lifted before the change: ${lastZ}`);
    const files = splitByTool(job.lines);
    if (files.length !== 2) say(`splits into ${files.length} files, not 2`);
    else {
      const second = files[1].map(l => l.replace(/\([^)]*\)/g, '').trim()).filter(Boolean);
      const spin = second.findIndex(l => /^M3/.test(l)), cut = second.findIndex(l => /^G1/.test(l));
      const lift = second.findIndex(l => /^G0 Z/.test(l));
      if (!(lift >= 0 && lift < spin && spin < cut)) say('the second file doesn\'t lift and start the spindle before it cuts');
      if (!/F\d/.test(second[cut])) say(`the second file's first cut has no feed: ${second[cut]}`);
      if (!/X/.test(second.find(l => /^G[01] .*[XY]/.test(l)) || '')) say('the second file never says where X is');
    }
  }

  // ---- read the moves back, each with the bit and the section it belongs to
  const moves = [];
  let pos = { x: 0, y: 0, z: machine.safeZ }, tool = 1, section = '', f = null;
  for (const raw of job.lines) {
    const note = raw.match(/^\((.*)\)$/);
    if (note) { section = note[1]; continue; }
    if (raw === 'M0') { tool = 2; continue; }
    const code = raw.replace(/\([^)]*\)/g, '');
    const g = code.match(/^G([01])\b/);
    if (!g) continue;
    const to = { ...pos };
    for (const [, k, v] of code.matchAll(/([XYZF])(-?[\d.]+)/g)) {
      if (k === 'F') f = +v; else to[k.toLowerCase()] = +v;
    }
    moves.push({ from: pos, to, rapid: g[1] === '0', tool, section, f });
    pos = to;
  }

  // ---- run them through the stock
  const res = 0.2;
  const map = new Stock(job.stock.x, job.stock.y, res);
  const surface = new Float64Array(map.z.length);
  for (let k = 0; k < surface.length; k++) surface[k] = part(...map.centre(k));
  // the highest the part gets in each 4 mm square, to skip the close look where the bit is well clear
  const B = 4, bx = Math.ceil(job.stock.x / B), by = Math.ceil(job.stock.y / B);
  const coarse = new Float64Array(bx * by).fill(-Infinity);
  for (let k = 0; k < surface.length; k++) {
    const [x, y] = map.centre(k);
    const c = Math.min(by - 1, Math.floor(y / B)) * bx + Math.min(bx - 1, Math.floor(x / B));
    coarse[c] = Math.max(coarse[c], surface[k]);
  }
  const highestNear = (x, y, r) => {
    let top = -Infinity;
    for (let j = Math.max(0, Math.floor((y - r) / B)); j <= Math.min(by - 1, Math.floor((y + r) / B)); j++) {
      for (let i = Math.max(0, Math.floor((x - r) / B)); i <= Math.min(bx - 1, Math.floor((x + r) / B)); i++) top = Math.max(top, coarse[j * bx + i]);
    }
    return top;
  };
  const radius = { 1: rough.diameter / 2, 2: finish.diameter / 2 };
  const a = job.allowance;
  let gouge = { depth: 0 }, thin = { depth: 0 }, plunges = 0, lowest = Infinity, biggestBite = { bite: 0 };
  const steepest = Math.tan((rough.rampAngle + 0.5) * Math.PI / 180);
  const tabSlack = 1.5 * rough.tabHeight + rough.doc + 0.05;
  for (const mv of moves) {
    const { from: p, to: q } = mv;
    if (q.x < -1e-6 || q.y < -1e-6 || q.x > machine.travel.x || q.y > machine.travel.y) say(`move to X${q.x} Y${q.y} is off the machine`);
    lowest = Math.min(lowest, q.z);
    const R = radius[mv.tool], ball = mv.tool === 2;
    const run = Math.hypot(q.x - p.x, q.y - p.y);
    if (mv.rapid) {
      if (run > 1e-6 && Math.min(p.z, q.z) < machine.safeZ - 1e-6) say(`rapid sideways at Z${fmt(Math.min(p.z, q.z))}, below safe Z`);
      if (map.highest(q.x, q.y, R) > q.z + 1e-6) say(`rapid into the stock at X${fmt(q.x)} Y${fmt(q.y)} Z${fmt(q.z)}`);
      continue;
    }
    // GRBL slows any move to each axis's top speed by itself, but the finish's time is worked out
    // as if it doesn't have to
    if (mv.tool === 2 && Math.abs(q.z - p.z) > 0.05 && mv.f > 1.01 * machine.maxFeed.z * Math.hypot(run, q.z - p.z) / Math.abs(q.z - p.z)) say(`Z moves faster than ${machine.maxFeed.z} mm/min at X${fmt(q.x)} Y${fmt(q.y)}${process.env.DEBUG3D ? " " + JSON.stringify(mv) : ""}`);
    const n = Math.max(1, Math.ceil(Math.max(run, Math.abs(q.z - p.z)) / res));
    let prev = p;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const at = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t };
      const { bite, tipBite, where } = map.cut(at, R, ball);
      biteTrack: {
        const drop = prev.z - at.z, step = Math.hypot(at.x - prev.x, at.y - prev.y);
        if (drop <= 1e-9 || bite < 0.01) break biteTrack;
        const slope = step < 1e-9 ? Infinity : drop / step;
        if (!ball && slope > steepest && !(bite <= tabSlack && slope <= 1.01)) {
          if (plunges++ < 3) say(`steep entry into material with the flat bit at X${fmt(at.x)} Y${fmt(at.y)} Z${fmt(at.z)}, ${fmt(bite)} mm deep`);
        }
        // the ball rides down slopes, but never goes straight down into more than the allowance
        if (ball && slope > 4 && tipBite > a + 0.25) {
          if (plunges++ < 3) say(`ball goes straight down into ${fmt(tipBite)} mm of material at X${fmt(at.x)} Y${fmt(at.y)} Z${fmt(at.z)}`);
        }
      }
      if (ball && bite > biggestBite.bite) biggestBite = { bite, x: at.x, y: at.y, z: at.z, where };
      prev = at;
      // compare with the part, all round the bit
      if (highestNear(at.x, at.y, R + a) < at.z - a) continue;
      const span = Math.ceil((R + a) / res);
      const [ci, cj] = map.cell(at.x, at.y);
      for (let j = cj - span; j <= cj + span; j++) {
        for (let i = ci - span; i <= ci + span; i++) {
          if (i < 0 || j < 0 || i >= map.nx || j >= map.ny) continue;
          const k = j * map.nx + i;
          if (surface[k] === -Infinity) continue;
          const [x, y] = map.centre(k);
          const d = Math.hypot(x - at.x, y - at.y);
          // How far the part reaches into the bit, the shortest way out. (Straight down would make a
          // hair's touch on the side of a wall look like a deep cut.)
          if (d < R) {
            const into = ball ? R - Math.hypot(d, Math.max(0, at.z + R - surface[k])) : Math.min(surface[k] - at.z, R - d);
            if (into > gouge.depth) gouge = { depth: into, x, y, tool: mv.tool, section: mv.section, at, mv };
          }
          // the roughing stays the allowance off the part all round, sideways and down
          if (!ball && mv.section === 'roughing' && d <= R + a - 0.05 && surface[k] > at.z - a + thin.depth) {
            thin = { depth: surface[k] - at.z + a, x, y };
          }
        }
      }
    }
  }
  // The mesh's facets sit up to 0.01 mm inside the true surface, offset corners are chords 0.01 mm
  // inside the arc, and closing hairline gaps rounds sharp outside corners by 0.02 mm (as for flat parts).
  if (gouge.depth > 0.03) say(`gouge: tool ${gouge.tool} (${gouge.section}) cuts ${fmt(gouge.depth)} mm into the part near X${fmt(gouge.x)} Y${fmt(gouge.y)}${process.env.DEBUG3D ? " " + JSON.stringify({ at: gouge.at, mv: gouge.mv }) : ""}`);
  if (thin.depth > 0.03) say(`the roughing comes ${fmt(thin.depth)} mm closer to the part than the allowance, near X${fmt(thin.x)} Y${fmt(thin.y)}`);
  if (lowest < -H - rough.overcut - 0.001) say(`goes down to Z${fmt(lowest)}, below the stock bottom plus overcut`);

  // ---- the finish left the surface smooth: what's left over the part, where the ball can reach
  const rb = finish.diameter / 2;
  const scallop = rb - Math.sqrt(rb * rb - (finish.stepover * finish.diameter / 2) ** 2);
  const over = [];
  for (let k = 0; k < surface.length; k++) {
    if (surface[k] < job.floor + 0.1) continue; // the lip under the tabs, and off the part
    over.push(map.z[k] - surface[k]);
  }
  over.sort((p, q) => p - q);
  // Where the part is gentle (no steeper than 45 degrees) and well away from any wall or edge,
  // a raster finish leaves nothing but scallops. A spot the finish skipped shows up here.
  const nx = map.nx, wall = new Uint8Array(surface.length), gentle = [];
  for (let k = 0; k < surface.length; k++) {
    if (!isFinite(surface[k])) continue;
    const near = [k - 1, k + 1, k - nx, k + nx].map(n => surface[n]);
    if (near.some(h => !(h > -Infinity) || Math.abs(h - surface[k]) > 2 * res)) wall[k] = 1;
  }
  const keepOff = Math.ceil((rb + job.allowance) / res);
  const nearWall = new Uint8Array(surface.length);
  for (let k = 0; k < surface.length; k++) {
    if (!wall[k]) continue;
    const i = k % nx, j = Math.floor(k / nx);
    for (let dj = -keepOff; dj <= keepOff; dj++) for (let di = -keepOff; di <= keepOff; di++) {
      if (di * di + dj * dj <= keepOff * keepOff && i + di >= 0 && i + di < nx && j + dj >= 0 && j + dj < map.ny) nearWall[(j + dj) * nx + i + di] = 1;
    }
  }
  for (let k = 0; k < surface.length; k++) {
    if (!isFinite(surface[k]) || nearWall[k] || surface[k] < job.floor + 0.1) continue;
    const near = [k - 1, k + 1, k - nx, k + nx].map(n => surface[n]);
    if (near.every(h => Math.abs(h - surface[k]) <= res)) gentle.push(map.z[k] - surface[k]);
  }
  gentle.sort((p, q) => p - q);
  const left = {
    median: over[over.length >> 1], p95: over[Math.floor(over.length * 0.95)], scallop,
    gentle: { count: gentle.length, p99: gentle[Math.floor(gentle.length * 0.99)], max: gentle[gentle.length - 1] },
  };
  return { problems, left, biggestBite };
}

// The stock as a grid of heights, starting flat at Z0, cut down by a flat or ball bit.
class Stock {
  constructor(w, h, res) {
    this.res = res;
    this.nx = Math.ceil(w / res);
    this.ny = Math.ceil(h / res);
    this.z = new Float64Array(this.nx * this.ny);
  }

  // (set off a little from the whole millimetres, so no cell's middle sits right on a straight wall)
  centre(k) {
    return [(k % this.nx + 0.5) * this.res + 0.037, (Math.floor(k / this.nx) + 0.5) * this.res + 0.037];
  }

  cell(x, y) {
    return [Math.floor((x - 0.037) / this.res), Math.floor((y - 0.037) / this.res)];
  }

  highest(x, y, r) {
    let top = -Infinity;
    this.each(x, y, r, k => { top = Math.max(top, this.z[k]); });
    return top;
  }

  each(x, y, r, fn) {
    const [ci, cj] = this.cell(x, y);
    const span = Math.ceil(r / this.res);
    for (let j = Math.max(0, cj - span); j <= Math.min(this.ny - 1, cj + span); j++) {
      for (let i = Math.max(0, ci - span); i <= Math.min(this.nx - 1, ci + span); i++) {
        const k = j * this.nx + i;
        const [cx, cy] = this.centre(k);
        const d = Math.hypot(cx - x, cy - y);
        if (d <= r) fn(k, d);
      }
    }
  }

  // Lowers the stock under the bit at `at`. Returns the most it took off any one cell, and how much
  // was right under the tip.
  cut(at, r, ball) {
    let bite = 0, tipBite = 0, where = null;
    this.each(at.x, at.y, r, (k, d) => {
      const low = ball ? at.z + r - Math.sqrt(r * r - d * d) : at.z;
      if (this.z[k] > low) {
        // for the ball, how far into it the material reaches, which on a steep side is the thin
        // layer it shaves off, not the height of it
        const deep = ball ? r - Math.hypot(d, Math.max(0, at.z + r - this.z[k])) : this.z[k] - low;
        if (deep > bite) { bite = deep; where = [...this.centre(k), this.z[k], low]; }
        if (d < this.res) tipBite = Math.max(tipBite, this.z[k] - low);
        this.z[k] = low;
      }
    });
    return { bite, tipBite, where };
  }
}
