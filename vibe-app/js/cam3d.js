// Makes GRBL toolpaths for a curved part (from mesh.js), cut from the top:
//   1. roughing with a flat end mill, in layers, leaving a thin allowance on the part,
//   2. the outline with tabs, with the same bit,
//   3. a stop to put in the ball-nose bit and re-zero Z,
//   4. the finish: the ball runs back and forth across the part, riding on its surface.
// The roughing and the outline reuse the flat part's pocket and profile cuts, so every way into the
// material still ramps. The finish only ever goes down in places the roughing already opened up.

import { SCALE, offset, union, difference, pieces, reversed, perimeter, area, bounds, scanline, tidy } from './geom.js';
import { closeGaps } from './part.js';
import { quarterTurn, ballDropper } from './mesh.js';
import { BITS, MATERIALS, CamError, Job, tidySettings, depthsDown, insideAll, mm } from './cam.js';

// what the roughing leaves on the part for the finish to take off
const ALLOWANCE = { aluminium: 0.3, polycarbonate: 0.4, wood: 0.5 };

export function make3dToolpaths(solid, roughGiven, finishGiven, machine) {
  if (BITS[roughGiven.bit]?.ball) throw new CamError('Rough it out with a flat end mill. The ball-nose bit is for the finish.');
  if (!BITS[finishGiven.bit]?.ball) throw new CamError('The finish needs a ball-nose bit.');
  const warnings = [...solid.notes];
  const H = solid.height;
  const rough = tidySettings(roughGiven, machine, H, warnings);
  const more = [];
  const finish = tidySettings(finishGiven, machine, H, more);
  for (const w of more) if (!warnings.includes(w)) warnings.push(w);
  const r = rough.diameter / 2, rb = finish.diameter / 2;
  // each layer leaves a step on the part for the ball to take off, so keep them small (Help says so)
  rough.doc = Math.min(rough.doc, 1.5);
  const allowance = ALLOWANCE[rough.material] ?? 0.4;

  // The roughing clears this far past the outline, so the ball can run right off the part's edge.
  // Past that an 8 mm rim of stock stays uncut, to re-zero the second bit on.
  const wide = 2 * rb + 1;
  const margin = wide + rough.diameter + 8;
  const fits = size => size.x + 2 * margin <= machine.travel.x && size.y + 2 * margin <= machine.travel.y;
  if (!fits(solid.size) && fits({ x: solid.size.y, y: solid.size.x })) solid = quarterTurn(solid);
  if (H + rough.overcut + machine.safeZ > machine.travel.z) {
    throw new CamError(`The part is ${mm(H)} mm tall, which is more than the machine's Z travel (${machine.travel.z} mm) can cut with a ${mm(machine.safeZ)} mm lift.`);
  }
  const stock = { x: solid.size.x + 2 * margin, y: solid.size.y + 2 * margin };
  if (stock.x > machine.travel.x || stock.y > machine.travel.y) {
    throw new CamError(`The part needs ${mm(stock.x)} x ${mm(stock.y)} mm of stock, but the machine only travels ${machine.travel.x} x ${machine.travel.y} mm. It won't fit.`);
  }
  // Nothing below the tab tops gets cut until the outline, so the part stays held while it's
  // roughed and finished. Where the part dips lower than that, a lip that high is left on it.
  if (rough.tabHeight < 0.5) {
    rough.tabHeight = Math.min(0.5, H / 2);
    warnings.push(`The tabs are ${mm(rough.tabHeight)} mm tall, because they hold the part while it's finished.`);
  }
  const floor = -H + rough.tabHeight;
  const zThrough = -H - rough.overcut;

  const job = new Job(rough, machine, margin);
  const done = [];
  const skipped = solid.undercuts.map(u => ({
    what: `undercut near X${mm(u.where.minX)} to ${mm(u.where.maxX)}, Y${mm(u.where.minY)} to ${mm(u.where.maxY)} mm`,
    why: 'the bits only reach it from the top, so it\'s left solid. Cut it by hand or in a second setup.',
    where: u.where,
  }));

  // ---- roughing: every layer clears the stock down to that height, except where the part (plus
  // the allowance all round) is higher
  const bodies = pieces(solid.silhouette);
  const filled = union(bodies.map(b => b.outer));
  // The slice comes in whole cells, a staircase. Thinned out it offsets far quicker; grown first by
  // as much as thinning can move an edge, it still holds everything it held before. Each layer
  // also keeps everything the one above it kept, so a layer never reaches anywhere the one above
  // didn't clear (the pocket goes down to each new layer through what the last one cut). The
  // pocket asks for the layers top down.
  const t = solid.res / 2;
  const keeps = new Map();
  let above = [];
  const keepAbove = z => {
    const key = z.toFixed(4);
    if (!keeps.has(key)) {
      above = union([...above, ...offset(offset(solid.sliceAbove(z - allowance), allowance + t).map(p => tidy(p, t * SCALE)), 0)]);
      keeps.set(key, above);
    }
    return keeps.get(key);
  };
  const depths = depthsDown(0, floor, rough.doc, solid.floors.map(h => h + allowance));
  job.note('roughing');
  const cut = job.pocket(offset(filled, wide), depths, keepAbove);
  done.push(`roughing, ${depths.length} layers down to Z${mm(floor)}`);
  if (cut.missed > 1) warnings.push(`About ${mm(cut.missed)} mm² is too narrow for the roughing bit to get into, so the ball-nose bit takes it down a layer at a time. A smaller roughing bit is quicker.`);

  // ---- the outline, and holes right through, with the same bit. Above the part's edge the
  // roughing already cleared it, so the cut starts at the first layer that reaches the edge.
  const edgeTop = solid.highestOutside(offset(solid.silhouette, -(allowance + 3 * solid.res)));
  const top = [0, ...depths].filter(z => z >= edgeTop + allowance - 1e-9).pop() ?? 0;
  for (const p of offset(bodies.map(b => b.outer), r)) {
    job.note('outline');
    job.profile(p, zThrough, area(p) > 0 ? rough.climb : !rough.climb, true, top);
  }
  for (const body of bodies) done.push(`outline (${mm(perimeter(body.outer))} mm around)`);
  for (const body of bodies) {
    for (const hole of body.holes) {
      const shape = reversed(hole);
      const where = bounds([shape]);
      const label = `${mm(where.maxX - where.minX)} x ${mm(where.maxY - where.minY)} mm hole`;
      const paths = closeGaps(difference([shape], offset(solid.silhouette, r)));
      if (!paths.length || paths.some(p => perimeter(p) < 0.2 * Math.PI * rough.diameter)) {
        skipped.push({ what: label, why: `it's too small for the ${mm(rough.diameter)} mm bit. Drill it by hand, or use a smaller bit.`, where });
        continue;
      }
      // tabs on every one, so no loose piece is left for the ball to catch
      job.note(label);
      for (const p of paths) job.profile(p, zThrough, !rough.climb, true, top);
      done.push(label);
    }
  }

  // ---- what's left after that, so the finish never takes too much in one go
  const left = new Stock(stock, 0.3);
  let at = { x: 0, y: 0, z: machine.safeZ };
  for (const mv of job.moves) {
    if (mv.note) continue;
    if (!mv.rapid) left.cut(at, mv, r, false);
    at = mv;
  }

  // ---- the finish
  job.changeTool(finish);
  job.note(`finish with the ${BITS[finish.bit].name}`);
  // The ball rides on the part, but never sinks more than `most` into what's left. Where the
  // roughing bit couldn't get in, that holds it up, and the row gets done again, a layer lower
  // each time, until the ball reaches the part.
  const drop = ballDropper(solid, rb);
  const most = allowance + 0.3;
  let held = false;
  const surface = (x, y) => {
    const onPart = Math.max(drop(x, y), floor);
    const z = Math.max(onPart, left.lowest(...job.at(x, y), rb, most));
    if (z > onPart + 0.01) held = true;
    return z;
  };
  const region = offset(filled, rb + allowance + 0.3); // the ball's centre, just off the part all round
  const roomy = offset(filled, wide + rough.diameter - rb - 0.2); // the ball stays inside what was roughed
  const step = finish.stepover * finish.diameter;
  const box = bounds(region);
  const rows = Math.max(1, Math.ceil((box.maxY - box.minY) / step));

  // Feeds to (x, y, z) (part coordinates), never faster down than Z can go.
  const cutTo = (x, y, z) => {
    const [X, Y] = job.at(x, y);
    let f = finish.feed;
    const dz = Math.abs(z - job.pos.z);
    if (dz > 1e-9) f = Math.min(f, machine.maxFeed.z * Math.hypot(X - job.pos.x, Y - job.pos.y, dz) / dz);
    const from = { ...job.pos };
    job.feed(X, Y, z, Math.floor(f));
    left.cut(from, job.pos, rb, true);
  };
  // Gets the ball to (x, y) on the surface: along the surface if the way there stays in the
  // roughed area, otherwise up, across and down into the open space past the part's edge.
  const goTo = (x, y) => {
    const z = surface(x, y);
    const [X, Y] = job.at(x, y);
    const down = job.pos.z < machine.safeZ - 1e-6;
    if (down && insideAll([[job.pos.x, job.pos.y], [X, Y]], roomy, margin)) {
      for (const p of overSurface(surface, [job.pos.x - margin, job.pos.y - margin], [x, y]).slice(1)) cutTo(...p);
    } else {
      job.lift();
      job.enter(X, Y, z);
      cutTo(x, y, z);
    }
  };
  let forward = true, again = 0;
  let todo = Array.from({ length: rows }, (_, k) => k);
  for (let pass = 0; todo.length && pass < 40; pass++) {
    const next = [];
    for (const k of todo) {
      const y = box.minY + (k + 0.5) * (box.maxY - box.minY) / rows;
      const xs = scanline(region, y);
      const spans = [];
      for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 0.01) spans.push([xs[i], xs[i + 1]]);
      if (!forward) spans.reverse().forEach(s => s.reverse());
      held = false;
      for (const [xa, xb] of spans) {
        goTo(xa, y);
        for (const p of overSurface(surface, [xa, y], [xb, y]).slice(1)) cutTo(...p);
      }
      if (held) next.push(k);
      if (spans.length) forward = !forward;
    }
    if (pass) again += todo.length;
    todo = next;
  }
  job.lift();
  done.push(`finish, ${rows} passes ${mm(step)} mm apart${again ? `, and ${again} again where there was too much left to take off in one go` : ''}`);
  if (todo.length) warnings.push("Some spots the roughing bit couldn't reach are still not finished after 40 passes. Use a smaller roughing bit.");
  if (H > rough.diameter * 4 || H > finish.diameter * 4) {
    warnings.push(`The cut goes ${mm(H + rough.overcut)} mm deep. Check that both bits' flutes are at least that long, and that nothing but the flutes can touch the part.`);
  }

  const lines = job.finish([
    `GRBL Prep 3D part, ${MATERIALS[rough.material].name}`,
    `Tool 1: ${BITS[rough.bit].name} end mill for the roughing and the outline. Tool 2: ${BITS[finish.bit].name} for the finish`,
    `Stock: at least ${mm(stock.x)} x ${mm(stock.y)} mm, ${mm(H)} mm thick`,
    'Zero X0 Y0 on the front left corner of the stock and Z0 on its top',
  ]);
  return { lines, done, skipped, warnings, minutes: job.minutes(), stock, margin, settings: rough, finish, solid, allowance, floor };
}

// The ball's path from a to b (x, y) riding on the surface, as [x, y, z] points: sampled every
// 0.2 mm, with more points wherever the surface bends between two of them, then thinned out to
// what's needed to stay within 0.005 mm of it. Where the ball meets a wall its height jumps, which
// halving can't smooth out; there it goes straight up (or down) at the lower end instead.
function overSurface(heightAt, a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const at = s => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  const z = s => heightAt(...at(s));
  const pts = [];
  const add = (s0, z0, s1, z1, depth) => {
    const sm = (s0 + s1) / 2, zm = z(sm);
    if (Math.abs(zm - (z0 + z1) / 2) > 0.002) {
      if (depth < 10) {
        add(s0, z0, sm, zm, depth + 1);
        add(sm, zm, s1, z1, depth + 1);
        return;
      }
      const top = Math.max(z0, zm, z1);
      if (z0 < top) pts.push([s0, top]);
      if (z1 < top) pts.push([s1, top]);
    }
    pts.push([s1, z1]);
  };
  const n = Math.max(1, Math.ceil(len / 0.2));
  let prev = [0, z(0)];
  pts.push(prev);
  for (let i = 1; i <= n; i++) {
    const s = i / n, zs = z(s);
    add(prev[0], prev[1], s, zs, 0);
    prev = [s, zs];
  }
  // Douglas-Peucker, keeping the ends, by distance in mm at right angles to the line
  const mmPt = ([s, h]) => [s * len, h];
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [x0, z0] = mmPt(pts[i]), [x1, z1] = mmPt(pts[j]);
    const L = Math.hypot(x1 - x0, z1 - z0);
    let far = -1, farD = 0.005;
    for (let k = i + 1; k < j; k++) {
      const [x, h] = mmPt(pts[k]);
      const d = L > 1e-12 ? Math.abs((x1 - x0) * (h - z0) - (z1 - z0) * (x - x0)) / L : Math.hypot(x - x0, h - z0);
      if (d > farD) { farD = d; far = k; }
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([i, far], [far, j]);
    }
  }
  return pts.filter((_, i) => keep[i]).map(([s, h]) => [...at(s), h]);
}

// The top of the stock as a grid, cut down along each move. Only used to see how much is left
// for the finish, so cell middles are close enough.
class Stock {
  constructor(size, res) {
    this.res = res;
    this.nx = Math.ceil(size.x / res) + 1;
    this.ny = Math.ceil(size.y / res) + 1;
    this.z = new Float32Array(this.nx * this.ny);
  }

  // The lowest a ball of radius r can go at (x, y) (its tip's height) without the stock reaching
  // more than `most` into it, measured from the ball's centre. On a steep side that's the thin
  // layer it shaves off, not the height of it. It's the same as resting a smaller ball, r - most
  // in radius, with the same centre, on the stock.
  lowest(x, y, r, most) {
    const { res, nx, ny } = this;
    const small = r - most;
    let z = -Infinity;
    for (let j = Math.max(0, Math.floor((y - small) / res)); j <= Math.min(ny - 1, Math.floor((y + small) / res)); j++) {
      for (let i = Math.max(0, Math.floor((x - small) / res)); i <= Math.min(nx - 1, Math.floor((x + small) / res)); i++) {
        const d = Math.hypot((i + 0.5) * res - x, (j + 0.5) * res - y);
        if (d < small) z = Math.max(z, this.z[j * nx + i] - r + Math.sqrt(small * small - d * d));
      }
    }
    return z;
  }

  // Lowers the stock under a flat bit, or a ball, on a straight move from a to b.
  cut(a, b, r, ball) {
    const { res, nx, ny } = this;
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r) / res)), i1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x) + r) / res));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - r) / res)), j1 = Math.min(ny - 1, Math.ceil((Math.max(a.y, b.y) + r) / res));
    for (let j = j0; j <= j1; j++) {
      const cy = (j + 0.5) * res;
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * res;
        const t = len2 ? Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / len2)) : 0;
        const d = Math.hypot(cx - a.x - t * dx, cy - a.y - t * dy);
        if (d > r) continue;
        const z = a.z + (b.z - a.z) * t + (ball ? r - Math.sqrt(r * r - d * d) : 0);
        const k = j * nx + i;
        if (z < this.z[k]) this.z[k] = z;
      }
    }
  }
}
