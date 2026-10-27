// Random flat parts for the fuzz test, built the way Onshape describes a part (faces with loops of
// tessellated edges, see compactPart in js/part.js), plus the truth about each one.
// The same seed always gives the same part.

import './clipper.js';
import { toInt, toMm, union, difference, intersection, pieces, totalArea } from '../js/geom.js';
import { BITS } from '../js/cam.js';

export function random(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    chance: p => next() < p,
    pick: list => list[Math.floor(next() * list.length)],
  };
}

// ---- 2D shapes, as lists of [x, y] in mm, anticlockwise

const circle = (cx, cy, r, n) => {
  n = n || Math.max(12, Math.min(180, Math.ceil(2 * Math.PI * r / 0.6)));
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);
};
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

function roundRect(x, y, w, h, rad) {
  rad = Math.min(rad, w / 2, h / 2);
  if (rad < 0.05) return rect(x, y, w, h);
  const out = [];
  const corners = [[x + w - rad, y + rad, -90], [x + w - rad, y + h - rad, 0], [x + rad, y + h - rad, 90], [x + rad, y + rad, 180]];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= 8; k++) {
      const a = (a0 + 90 * k / 8) * Math.PI / 180;
      out.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
    }
  }
  return out;
}

function star(cx, cy, r, points, depth) {
  return Array.from({ length: points * 2 }, (_, i) => {
    const rr = i % 2 ? r * depth : r;
    const a = Math.PI * i / points;
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  });
}

// a smooth closed curve, like a spline outline
function blob(R, cx, cy, r) {
  const waves = Array.from({ length: R.int(2, 5) }, () => [R.int(2, 7), R.between(0.05, 0.25), R.between(0, 6.3)]);
  const n = 160;
  return Array.from({ length: n }, (_, i) => {
    const a = 2 * Math.PI * i / n;
    const rr = r * (1 + waves.reduce((s, [k, amp, ph]) => s + amp * Math.sin(k * a + ph), 0));
    return [cx + Math.max(r * 0.2, rr) * Math.cos(a), cy + Math.max(r * 0.2, rr) * Math.sin(a)];
  });
}

// a comb: lots of sharp inside corners
function comb(w, h, teeth, gap) {
  const out = [[0, 0], [w, 0]];
  const pitch = w / teeth;
  for (let i = teeth - 1; i >= 0; i--) {
    const x0 = i * pitch;
    out.push([x0 + pitch, h], [x0 + pitch - (pitch - gap), h]);
    if (i > 0) out.push([x0 + pitch - (pitch - gap), h * 0.4], [x0, h * 0.4]);
  }
  return out.map(([x, y]) => [x, y]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
}

const lShape = (w, h, t) => [[0, 0], [w, 0], [w, t], [t, t], [t, h], [0, h]];

const turn = (pts, deg, cx = 0, cy = 0) => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
};
const move = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
const box = pts => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

// a random point well inside some region, or null
function pointIn(R, region, tries = 40) {
  const C = globalThis.ClipperLib.Clipper;
  const pts = region.flatMap(toMm);
  if (!pts.length) return null;
  const b = box(pts);
  for (let i = 0; i < tries; i++) {
    const x = R.between(b.minX, b.maxX), y = R.between(b.minY, b.maxY);
    const pt = { X: Math.round(x * 1000), Y: Math.round(y * 1000) };
    let n = 0;
    for (const p of region) if (C.PointInPolygon(pt, p) === 1) n++;
    if (n % 2) return [x, y];
  }
  return null;
}

// ---- the part

export function makePart(seed, { place = true } = {}) {
  const R = random(seed);
  const material = R.pick(['aluminium', 'polycarbonate', 'wood']);
  const bit = R.pick(['eighth', 'quarter', 'mm3']);
  const D = BITS[bit].diameter;
  const inch = R.chance(0.4);
  const T = inch ? R.pick([1 / 16, 1 / 8, 3 / 16, 1 / 4, 3 / 8, 1 / 2]) * 25.4 : R.pick([1.5, 2, 3, 4, 5, 6, 8, 10, 12]);
  const tags = [];
  const tag = t => tags.push(t);

  // size and outline
  const sizeKind = R.pick(['tiny', 'small', 'small', 'medium', 'medium', 'medium', 'large', 'huge']);
  const size = { tiny: R.between(4, 20), small: R.between(20, 80), medium: R.between(80, 250), large: R.between(250, 360), huge: R.between(380, 800) }[sizeKind];
  if (inch && R.chance(0.5)) tag('inch sizes');
  const sz = inch ? Math.round(size / 3.175) * 3.175 || 3.175 : size;
  tag(sizeKind);
  const kind = R.pick(['rect', 'rect', 'roundrect', 'circle', 'star', 'blob', 'lshape', 'comb', 'sliver', 'polygon']);
  tag(kind);
  const w = sz, h = sz * R.between(0.4, 1);
  let outline = {
    rect: () => rect(0, 0, w, h),
    roundrect: () => roundRect(0, 0, w, h, R.between(0.5, sz / 4)),
    circle: () => circle(w / 2, w / 2, w / 2),
    star: () => star(w / 2, w / 2, w / 2, R.int(3, 9), R.between(0.25, 0.7)),
    blob: () => blob(R, w / 2, w / 2, w / 2.8),
    lshape: () => lShape(w, h, Math.max(1, h * R.between(0.15, 0.5))),
    comb: () => comb(w, h, R.int(2, 8), Math.max(0.3, w / 16 * R.between(0.2, 1.5))),
    sliver: () => rect(0, 0, w, R.between(0.3, 8)),
    polygon: () => {
      const n = R.int(5, 14);
      return Array.from({ length: n }, (_, i) => {
        const a = 2 * Math.PI * i / n, rr = w / 2 * R.between(0.35, 1);
        return [w / 2 + rr * Math.cos(a), w / 2 + rr * Math.sin(a)];
      });
    },
  }[kind]();
  if (R.chance(0.3)) { outline = turn(outline, R.between(0, 360)); tag('turned'); }
  if (R.chance(0.3)) { outline = move(outline, R.between(-500, 0), R.between(-500, 0)); tag('negative coordinates'); }
  const ob = box(outline);
  const span = Math.min(ob.maxX - ob.minX, ob.maxY - ob.minY);

  let outlines = [outline];
  if (R.chance(0.08)) {
    // a second body next to the first: far, close, or overlapping
    const gap = R.pick([20, D * 0.6, D * 1.5, -2]);
    outlines.push(move(rect(0, 0, Math.max(5, span / 2), Math.max(5, span / 2)), ob.maxX + gap, ob.minY));
    tag(`two bodies ${gap < 0 ? 'overlapping' : gap < D ? 'closer than the bit' : 'apart'}`);
  }

  // through holes
  const holes = [];
  const solid = () => difference(union(outlines.map(toInt)), union(holes.map(toInt)));
  const nHoles = R.chance(0.2) ? 0 : R.int(1, 12);
  for (let i = 0; i < nHoles; i++) {
    const which = R.pick(['smaller', 'exact', 'just bigger', 'big', 'big', 'slot', 'narrow slot', 'near edge', 'touching outline', 'close pair']);
    const d = Math.min(span * 0.4, { smaller: D * R.between(0.4, 0.97), exact: D, 'just bigger': D * R.between(1.01, 1.3) }[which] ?? D * R.between(1.3, 6));
    let at = pointIn(R, solid());
    if (!at) break;
    if (which === 'near edge' || which === 'touching outline') {
      // walk out from the point toward the nearest edge of the outline
      const p = outline[R.int(0, outline.length - 1)];
      const t = which === 'near edge' ? R.between(0.6, 0.95) : R.between(0.97, 1.05);
      at = [at[0] + (p[0] - at[0]) * t, at[1] + (p[1] - at[1]) * t];
    }
    if (which === 'slot' || which === 'narrow slot') {
      const sw = which === 'narrow slot' ? D * R.between(0.5, 0.98) : D * R.between(1.2, 4);
      holes.push(move(turn(roundRect(-sw * 2, -sw / 2, sw * 4, sw, R.chance(0.5) ? sw / 2 : 0), R.between(0, 180)), at[0], at[1]));
    } else {
      holes.push(circle(at[0], at[1], d / 2));
      if (which === 'close pair') holes.push(circle(at[0] + d * R.between(0.9, 1.6), at[1], d / 2));
    }
    tag(`hole ${which}`);
  }

  // pockets, painted on in order: [region in µm, height from the bottom]
  const paint = [];
  const nPockets = R.chance(0.35) ? 0 : R.int(1, 4);
  for (let i = 0; i < nPockets; i++) {
    const which = R.pick(['rect', 'round', 'circle', 'island', 'nested', 'touching outline', 'narrow slot', 'deep']);
    const at = pointIn(R, solid());
    if (!at) break;
    const depth = which === 'deep' ? T * R.between(0.7, 0.95) : T * R.between(0.1, 0.7);
    const floor = Math.max(0.2, T - Math.round(depth * 10) / 10);
    const pw = Math.max(0.5, span * R.between(0.05, 0.4)), ph = Math.max(0.5, pw * R.between(0.3, 1));
    let shape = {
      rect: () => rect(-pw / 2, -ph / 2, pw, ph),
      round: () => roundRect(-pw / 2, -ph / 2, pw, ph, R.between(0, pw / 2)),
      circle: () => circle(0, 0, pw / 2),
      island: () => rect(-pw / 2, -ph / 2, pw, ph),
      nested: () => roundRect(-pw / 2, -ph / 2, pw, ph, pw / 8),
      'touching outline': () => rect(-pw / 2, -ph / 2, pw * 3, ph),
      'narrow slot': () => rect(-pw / 2, -D * 0.4, pw, D * R.between(0.3, 0.95)),
      deep: () => circle(0, 0, pw / 2),
    }[which]();
    shape = move(turn(shape, R.between(0, 90)), at[0], at[1]);
    paint.push([toInt(shape), floor]);
    if (which === 'island') paint.push([toInt(move(rect(-pw / 6, -ph / 6, pw / 3, ph / 3), at[0], at[1])), T]);
    if (which === 'nested') paint.push([toInt(move(circle(0, 0, pw / 5), at[0], at[1])), Math.max(0.1, floor - T * 0.25)]);
    tag(`pocket ${which}`);
  }

  // ---- work out the flat faces from all that
  const footprint = solid();
  let layers = [{ h: T, region: footprint }];
  for (const [shape, h] of paint) {
    const area = intersection([shape], footprint);
    layers = layers.map(l => ({ h: l.h, region: difference(l.region, area) }));
    layers.push({ h, region: area });
  }
  const tops = new Map();
  for (const l of layers) tops.set(l.h, [...(tops.get(l.h) || []), ...l.region]);

  const faces = [];
  const edges = [];
  const loopOf = (pts, z) => {
    // split each loop into a few edges, each stored whichever way round
    const n = pts.length;
    const cuts = [0, ...Array.from({ length: R.int(0, Math.min(3, n - 1)) }, () => R.int(1, n - 1))].sort((a, b) => a - b).filter((v, i, a) => i === 0 || v !== a[i - 1]);
    const coedges = cuts.map((c, k) => {
      const end = k + 1 < cuts.length ? cuts[k + 1] : n;
      const run = [];
      for (let i = c; i <= end; i++) run.push(pts[i % n]);
      const id = `E${edges.length}`;
      const flip = R.chance(0.5);
      edges.push({ id, type: run.length === 2 ? 'LINE' : 'SPLINE', points: (flip ? run.reverse() : run).map(([x, y]) => [x, y, z]) });
      return [id, R.chance(0.5)];
    });
    return coedges;
  };
  const planeFace = (region, z, up) => {
    for (const piece of pieces(region)) {
      const loops = [piece.outer, ...piece.holes].map((p, i) => ({ isOuter: i === 0, coedges: loopOf(toMm(p), z) }));
      const p0 = toMm(piece.outer)[0];
      const flip = R.chance(0.3); // same face, described with the normal turned round
      faces.push({ id: `F${faces.length}`, type: 'PLANE', normal: [0, 0, (up ? 1 : -1) * (flip ? -1 : 1)], origin: [p0[0], p0[1], z], orientation: !flip, loops });
    }
  };
  for (const [z, region] of tops) if (region.length) planeFace(region, z, true);
  planeFace(footprint, 0, false);

  // walls: straight sides become planes standing up, round holes become cylinders
  for (const piece of pieces(footprint)) {
    for (const path of [piece.outer, ...piece.holes]) {
      const pts = toMm(path);
      pts.forEach((a, i) => {
        const b = pts[(i + 1) % pts.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 2 || faces.length > 400) return;
        // material is on the left going round, so the outside is on the right
        const out = [(b[1] - a[1]) / len, (a[0] - b[0]) / len, 0];
        faces.push({ id: `F${faces.length}`, type: 'PLANE', normal: out, origin: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, T / 2], orientation: true, loops: [] });
      });
    }
  }
  for (const hole of holes) {
    const b = box(hole);
    faces.push({ id: `F${faces.length}`, type: 'CYLINDER', normal: [0, 0, 1], origin: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0], orientation: false, loops: [] });
  }

  // ---- things that make it not a plate, or broken
  let expect = 'cut';
  if (sizeKind === 'huge') expect = 'any'; // usually too big, but a long thin one may fit turned
  if (sizeKind === 'large') expect = 'any'; // might fit, might not
  if (T + 0.5 + 10 > 65) expect = 'reject';
  if (span < T * 1.5 || kind === 'sliver' || sizeKind === 'tiny' || kind === 'comb') expect = expect === 'reject' ? 'reject' : 'any';
  if (outlines.length > 1 || holes.length > 6) expect = expect === 'cut' ? 'any' : expect;
  // holes near the edge can eat most of a small part
  if (totalArea(footprint) < totalArea(union(outlines.map(toInt))) * 0.5) expect = expect === 'cut' ? 'any' : expect;

  const trouble = R.chance(0.22) ? R.pick(['tilted top', 'dome', 'overhang', 'zero-area loop', 'duplicate points', 'self-crossing outline', 'missing edge points', 'no faces', 'bad settings', 'big feeds']) : null;
  let settings = null;
  if (trouble) tag(trouble);
  if (trouble === 'tilted top') {
    const top = faces.find(f => f.normal[2] && f.origin[2] === T);
    if (top) top.normal = [Math.sin(0.1), 0, Math.cos(0.1)].map(v => v * Math.sign(top.normal[2]));
    expect = 'any';
  } else if (trouble === 'dome') {
    // the top is one curved surface, not flat
    for (const f of faces) if (f.type === 'PLANE' && f.normal[2] && f.origin[2] > 0) Object.assign(f, { type: R.pick(['SPHERE', 'OTHER']), normal: null });
    expect = 'reject';
  } else if (trouble === 'overhang') {
    const sq = rect(ob.minX + span * 0.3, ob.minY + span * 0.3, span * 0.3, span * 0.3);
    planeFace([toInt(sq)], T * 0.5, true);
    expect = totalArea(intersection([toInt(sq)], footprint)) > 1 ? 'reject' : 'any';
  } else if (trouble === 'zero-area loop') {
    faces[0].loops.push({ isOuter: false, coedges: loopOf([[ob.minX + 1, ob.minY + 1], [ob.minX + 2, ob.minY + 2], [ob.minX + 3, ob.minY + 3]], T) });
    expect = 'any';
  } else if (trouble === 'duplicate points') {
    for (const e of edges) e.points = e.points.flatMap(p => [p, p]);
  } else if (trouble === 'self-crossing outline') {
    const bottom = faces.find(f => f.type === 'PLANE' && f.origin[2] === 0 && f.loops.length);
    const e = bottom && edges.find(x => x.id === bottom.loops[0].coedges[0][0]);
    if (e && e.points.length > 3) [e.points[1], e.points[e.points.length - 2]] = [e.points[e.points.length - 2], e.points[1]];
    expect = 'any';
  } else if (trouble === 'missing edge points') {
    for (const e of edges) if (R.chance(0.1)) e.points = [];
    expect = 'any';
  } else if (trouble === 'no faces') {
    faces.length = 0;
    expect = 'reject';
  } else if (trouble === 'bad settings') {
    settings = R.pick([{ doc: 0 }, { stepover: 2 }, { feed: NaN }, { diameter: -1 }, { rampAngle: 0 }, { rpm: 'fast' }]);
    expect = 'reject';
  } else if (trouble === 'big feeds') {
    settings = { feed: 5000, rampFeed: 3000, rpm: 40000 };
  }

  // ---- place it in space: the plate can lie along any axis, anywhere
  const spin = R.pick(['flat', 'flat', 'on edge', 'upside down', 'any']);
  tag(`lying ${spin}`);
  let M = rotation(R, spin);
  let t = [R.between(-300, 300), R.between(-300, 300), R.between(-300, 300)];
  if (!place) [M, t] = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]]; // left where it was drawn, for debugging
  const placeAt = p => M.map(row => (row[0] * p[0] + row[1] * p[1] + row[2] * p[2]));
  for (const f of faces) {
    if (f.normal) f.normal = placeAt(f.normal);
    f.origin = placeAt(f.origin).map((v, k) => (v + t[k]) / 1000);
  }
  for (const e of edges) e.points = e.points.map(p => placeAt(p).map((v, k) => (v + t[k]) / 1000));

  const truth = {
    thickness: T,
    area: totalArea(footprint),
    holes: pieces(footprint).reduce((n, b) => n + b.holes.length, 0),
    bodies: pieces(footprint).length,
    floors: [...tops.keys()].filter(z => z < T - 1e-6).map(z => z - T),
  };
  return { seed, part: { faces, edges }, truth, expect, material, bit, settings, tags };
}

function rotation(R, spin) {
  const rx = a => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
  const rz = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
  const mul = (A, B) => A.map(row => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
  if (spin === 'flat') return rz(R.between(0, 6.3));
  if (spin === 'on edge') return mul(rx(Math.PI / 2), rz(R.between(0, 6.3)));
  if (spin === 'upside down') return mul(rx(Math.PI), rz(R.between(0, 6.3)));
  return mul(rz(R.between(0, 6.3)), mul(rx(R.between(0, 3.14)), rz(R.between(0, 6.3))));
}
