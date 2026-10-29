// About a hundred curved and odd parts for the 3D cut, as triangle meshes in mm: some an FRC team
// might really cut (rounded plates, dished pockets, hubs, knobs, team numbers in relief) and some
// meant to break things (egg crates, fins thinner than the bit, parts too tall or too big, broken
// meshes). Run them all with `node tests/curvedrun.js`.
//
// Each part says what should happen: `expect` is 'cut' or 'refuse', and `undercut` (when given)
// says whether some of it can't be reached from the top whichever way up it goes.

import { revolve } from './meshes.js';

// ---- builders

// Adds a triangle, turned round if it doesn't face along `out`.
function tri(list, a, b, c, out) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (Math.hypot(...n) < 1e-12) return;
  list.push(n[0] * out[0] + n[1] * out[1] + n[2] * out[2] >= 0 ? [a, b, c] : [a, c, b]);
}

// Points along 0..L, `res` apart, closer (`fine`) within `band` of either end.
export function axis(L, res, band = 0, fine = res) {
  const out = [0];
  while (out.at(-1) < L - 1e-9) {
    const x = out.at(-1);
    const step = x < band || x > L - band - fine ? fine : res;
    out.push(Math.min(L, x + step));
  }
  return out;
}

// A block on a flat bottom at Z0, with its top at top(x, y) over a grid of xs by ys.
export function block(xs, ys, top) {
  if (typeof xs === 'number') xs = axis(xs, 1);
  if (typeof ys === 'number') ys = axis(ys, 1);
  const w = xs.at(-1), d = ys.at(-1);
  const H = ys.map(y => xs.map(x => Math.max(0.2, top(x, y))));
  const p = (i, j) => [xs[i], ys[j], H[j][i]];
  const tris = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      tri(tris, p(i, j), p(i + 1, j), p(i + 1, j + 1), [0, 0, 1]);
      tri(tris, p(i, j), p(i + 1, j + 1), p(i, j + 1), [0, 0, 1]);
    }
  }
  // the walls, and the bottom as a fan to the same corners
  const ring = [
    ...xs.map((_, i) => [i, 0]), ...ys.slice(1).map((_, j) => [xs.length - 1, j + 1]),
    ...xs.slice(0, -1).map((_, i) => [xs.length - 2 - i, ys.length - 1]), ...ys.slice(1, -1).map((_, j) => [0, ys.length - 2 - j]),
  ];
  const mid = [w / 2, d / 2, 0];
  ring.forEach(([i, j], k) => {
    const [i2, j2] = ring[(k + 1) % ring.length];
    const a = [xs[i], ys[j], 0], b = [xs[i2], ys[j2], 0];
    const out = [ys[j2] - ys[j], -(xs[i2] - xs[i]), 0];
    tri(tris, a, b, p(i2, j2), out);
    tri(tris, a, p(i2, j2), p(i, j), out);
    tri(tris, mid, a, b, [0, 0, -1]);
  });
  return tris;
}

// A round part on a flat bottom, centred on X0 Y0, with its top at top(r, angle).
function disk(R, top, nr = 40, na = 120) {
  const tris = [];
  const p = (i, k) => {
    const r = R * i / nr, a = 2 * Math.PI * (k % na) / na;
    return i === 0 ? [0, 0, Math.max(0.2, top(0, 0))] : [r * Math.cos(a), r * Math.sin(a), Math.max(0.2, top(r, a))];
  };
  for (let k = 0; k < na; k++) {
    tri(tris, p(0, 0), p(1, k), p(1, k + 1), [0, 0, 1]);
    for (let i = 1; i < nr; i++) {
      tri(tris, p(i, k), p(i + 1, k), p(i + 1, k + 1), [0, 0, 1]);
      tri(tris, p(i, k), p(i + 1, k + 1), p(i, k + 1), [0, 0, 1]);
    }
    const a = p(nr, k), b = p(nr, k + 1), a0 = [a[0], a[1], 0], b0 = [b[0], b[1], 0];
    const mid = 2 * Math.PI * (k + 0.5) / na, out = [Math.cos(mid), Math.sin(mid), 0];
    tri(tris, a0, b0, b, out);
    tri(tris, a0, b, a, out);
    tri(tris, [0, 0, 0], a0, b0, [0, 0, -1]);
  }
  return tris;
}

// Cuts a polygon (anticlockwise) into triangles.
function earClip(pts) {
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p, a, b, c) => turn(a, b, p) >= 0 && turn(b, c, p) >= 0 && turn(c, a, p) >= 0;
  const idx = pts.map((_, i) => i), out = [];
  while (idx.length > 3) {
    let cut = false;
    for (let k = 0; k < idx.length && !cut; k++) {
      const [i0, i1, i2] = [idx[(k + idx.length - 1) % idx.length], idx[k], idx[(k + 1) % idx.length]];
      const [a, b, c] = [pts[i0], pts[i1], pts[i2]];
      if (turn(a, b, c) <= 1e-12) continue;
      if (idx.some(j => j !== i0 && j !== i1 && j !== i2 && inside(pts[j], a, b, c))) continue;
      out.push([a, b, c]);
      idx.splice(k, 1);
      cut = true;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx.map(i => pts[i]));
  return out;
}

// A polygon (x, y) pushed up from Z0 to h.
function prism(pts, h) {
  const signed = pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0);
  if (signed < 0) pts = [...pts].reverse();
  const tris = [];
  for (const [a, b, c] of earClip(pts)) {
    tri(tris, [...a, h], [...b, h], [...c, h], [0, 0, 1]);
    tri(tris, [...a, 0], [...b, 0], [...c, 0], [0, 0, -1]);
  }
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length], out = [b[1] - a[1], a[0] - b[0], 0];
    tri(tris, [...a, 0], [...b, 0], [...b, h], out);
    tri(tris, [...a, 0], [...b, h], [...a, h], out);
  });
  return tris;
}

// A quarter turn about X: a prism made from a side view (x, z) now lies along Y.
const rollX = tris => tris.map(t => t.map(([x, y, z]) => [x, -z, y]));
const move = (tris, dx, dy, dz) => tris.map(t => t.map(([x, y, z]) => [x + dx, y + dy, z + dz]));
// a quarter turn about Y, which lays a part on its side
const tipOver = tris => tris.map(t => t.map(([x, y, z]) => [z, y, -x]));
const tilt = (tris, deg) => {
  const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
  return tris.map(t => t.map(([x, y, z]) => [x, y * c - z * s, y * s + z * c]));
};
const arc = (cx, cz, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + (a1 - a0) * i / n;
  return [cx + r * Math.cos(a), cz + r * Math.sin(a)];
});
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (e, edge) => clamp(e / edge + 0.5, 0, 1); // 0 to 1 over `edge` mm, for walls in relief

// The top of a block with its top edges rounded off (radius r) or chamfered (c).
const rounded = (w, d, H, r) => (x, y) => {
  const q = Math.hypot(Math.max(0, r - Math.min(x, w - x)), Math.max(0, r - Math.min(y, d - y)));
  return H - r + Math.sqrt(Math.max(0, r * r - q * q));
};
const chamfered = (w, d, H, c) => (x, y) => H - Math.max(0, c - Math.min(x, w - x, y, d - y));

// ---- a stroke font for team numbers and labels, in a 4 x 6 box
const FONT = {
  '2': [[[0, 6], [4, 6], [4, 3], [0, 3], [0, 0], [4, 0]]],
  '8': [[[0, 0], [4, 0], [4, 6], [0, 6], [0, 0]], [[0, 3], [4, 3]]],
  '5': [[[4, 6], [0, 6], [0, 3], [4, 3], [4, 0], [0, 0]]],
  '4': [[[0, 6], [0, 3], [4, 3]], [[3, 6], [3, 0]]],
  'F': [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
  'R': [[[0, 0], [0, 6], [4, 6], [4, 3], [0, 3]], [[1.5, 3], [4, 0]]],
  'C': [[[4, 6], [0, 6], [0, 0], [4, 0]]],
  'U': [[[0, 6], [0, 0], [4, 0], [4, 6]]],
  'P': [[[0, 0], [0, 6], [4, 6], [4, 3], [0, 3]]],
};
// How far (x, y) is from the strokes of `text`, written from (x0, y0) with letters `size` mm tall.
function textDistance(text, x0, y0, size) {
  const k = size / 6, segs = [];
  [...text].forEach((ch, n) => {
    for (const line of FONT[ch]) {
      for (let i = 0; i + 1 < line.length; i++) {
        segs.push([x0 + (n * 6 + line[i][0]) * k, y0 + line[i][1] * k, x0 + (n * 6 + line[i + 1][0]) * k, y0 + line[i + 1][1] * k]);
      }
    }
  });
  return (x, y) => {
    let best = Infinity;
    for (const [ax, ay, bx, by] of segs) {
      const dx = bx - ax, dy = by - ay;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return best;
  };
}

// A little seeded noise, for terrain
function noise(seed) {
  const waves = [];
  let a = seed;
  const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 12; i++) {
    const f = 0.02 * 2 ** (i / 3), ang = rnd() * Math.PI * 2;
    waves.push([f * Math.cos(ang), f * Math.sin(ang), rnd() * Math.PI * 2, 1 / (1 + i)]);
  }
  return (x, y) => waves.reduce((s, [fx, fy, ph, amp]) => s + amp * Math.sin(2 * Math.PI * (fx * x + fy * y) + ph), 0);
}

// ---- the parts
const R = (r, z) => [r, z];
const part = (group, name, tris, more = {}) => ({ group, name, tris, expect: 'cut', ...more });

export function parts() {
  const list = [];
  const frc = (name, tris, more) => list.push(part('frc', name, tris, more));
  const crazy = (name, tris, more) => list.push(part('crazy', name, tris, more));

  // plates with rounded and chamfered edges
  frc('plate 120x80x10, 3 mm round on its top edges', block(axis(120, 2, 4, 0.5), axis(80, 2, 4, 0.5), rounded(120, 80, 10, 3)), { undercut: false });
  frc('plate 100x60x12, 6 mm round on its top edges', block(axis(100, 2, 7, 0.5), axis(60, 2, 7, 0.5), rounded(100, 60, 12, 6)), { undercut: false });
  frc('plate 90x50x8, 2 mm chamfer on its top edges', block(axis(90, 2, 3, 1), axis(50, 2, 3, 1), chamfered(90, 50, 8, 2)), { undercut: false });
  frc('bar 200x25x12, 4 mm round on its top edges', block(axis(200, 2, 5, 0.5), axis(25, 0.5), rounded(200, 25, 12, 4)), { undercut: false });
  frc('block 40x40x20, 10 mm round on its top edges', block(axis(40, 0.5), axis(40, 0.5), rounded(40, 40, 20, 10)), { undercut: false });
  frc('domed block 60x60, no flat top (reads as a plate on its side, too thick)', block(axis(60, 0.5), axis(60, 0.5), (x, y) => 20 + 10 * (1 - ((x - 30) ** 2 + (y - 30) ** 2) / 1800)), { undercut: false });
  frc('elevator end cap 30x30x15, fully rounded top', block(axis(30, 0.4), axis(30, 0.4), rounded(30, 30, 15, 12)), { undercut: false });

  // pockets with curved floors
  frc('plate with a dished pocket, R30 ball floor 6 deep', block(axis(80, 0.6), axis(60, 0.6), (x, y) => {
    const s = 900 - (x - 40) ** 2 - (y - 30) ** 2;
    return s > 0 ? Math.min(12, 36 - Math.sqrt(s)) : 12;
  }), { undercut: false });
  frc('plate with a pocket, 3 mm round where the floor meets the walls', block(axis(90, 0.5), axis(60, 0.5), (x, y) => {
    const e = Math.max(Math.abs(x - 45) - 30, Math.abs(y - 30) - 15); // < 0 inside the 60 x 30 pocket
    if (e > 0) return 12;
    const q = Math.max(0, 3 + e); // the round starts 3 mm in from the wall
    return 6 + 3 - Math.sqrt(Math.max(0, 9 - q * q));
  }), { undercut: false });
  frc('plate with three ball-end slots', block(axis(100, 0.5), axis(60, 0.5), (x, y) => {
    let z = 10;
    for (const cy of [15, 30, 45]) {
      const d = Math.hypot(Math.max(0, Math.abs(x - 50) - 30), y - cy);
      if (d < 4) z = Math.min(z, 10 - Math.sqrt(16 - d * d));
    }
    return z;
  }), { undercut: false });
  frc('variable-depth pocket, floor sloping 2 to 8 mm deep', block(axis(100, 0.5), axis(60, 0.5), (x, y) => (
    Math.abs(x - 50) < 40 && Math.abs(y - 30) < 20 ? 12 - (2 + 6 * (x - 10) / 80) : 12)), { undercut: false });
  frc('round pocket with a 4 mm round floor edge', disk(40, r => (r < 30 ? 6 + 4 - Math.sqrt(Math.max(0, 16 - Math.max(0, r - 26) ** 2)) : 14), 60, 140), { undercut: false });
  frc('urethane mould: hemisphere cavity R20 in a block', block(axis(60, 0.5), axis(60, 0.5), (x, y) => {
    const q = 400 - (x - 30) ** 2 - (y - 30) ** 2;
    return q > 0 ? 25 - Math.sqrt(q) : 25;
  }), { undercut: false });
  frc('plate with six spherical dimples', block(axis(90, 0.5), axis(60, 0.5), (x, y) => {
    let z = 8;
    for (const cx of [20, 45, 70]) for (const cy of [18, 42]) {
      const q = 64 - (x - cx) ** 2 - (y - cy) ** 2;
      if (q > 0) z = Math.min(z, 8 + 5 - Math.sqrt(q) - 0); // dimple 3 deep (R8 ball, 5 above)
    }
    return z;
  }), { undercut: false });

  // ramps, saddles, seats
  frc('ramp block, top sloping 5 to 25 mm', block(axis(80, 4), axis(40, 4), x => 5 + 20 * x / 80), { undercut: false });
  frc('curved ramp, quarter-circle top R40', block(axis(40, 0.5), axis(30, 5), x => 42 - Math.sqrt(1600 - x * x)), { undercut: false });
  frc('saddle (hyperbolic) 80x80', block(axis(80, 1), axis(80, 1), (x, y) => 15 + ((x - 40) ** 2 - (y - 40) ** 2) / 300), { undercut: false });
  frc('tube saddle: R25 groove along Y in a 60x50x30 block', block(axis(60, 0.5), axis(50, 5), x => {
    const q = 625 - (x - 30) ** 2;
    return q > 0 ? Math.min(30, 40 - Math.sqrt(q)) : 30;
  }), { undercut: false });
  frc('bearing block with a half-round seat R11', block(axis(50, 0.4), axis(25, 5), x => {
    const q = 121 - (x - 25) ** 2;
    return q > 0 ? 20 - Math.sqrt(q) : 20;
  }), { undercut: false });
  frc('pivot block with a round top (axle housing)', block(axis(40, 0.5), axis(30, 5), x => 15 + Math.sqrt(Math.max(0, 400 - (x - 20) ** 2)) - 0), { undercut: false });
  frc('intake funnel: two sloped sides meeting at a 6 mm flat', block(axis(100, 1), axis(60, 6), x => 4 + Math.max(0, Math.abs(x - 50) - 3) * 0.35), { undercut: false });
  frc('drive skid with a curved front', block(axis(120, 1), axis(20, 4), x => (x < 30 ? 4 + 8 * Math.sqrt(1 - ((30 - x) / 30) ** 2) : 12)), { undercut: false });
  frc('wedge 20 degrees with a 10 mm round where it meets the flat', block(axis(80, 0.5), axis(30, 5), x => {
    const t = Math.tan(20 * Math.PI / 180);
    const lin = x < 40 ? 5 : 5 + (x - 40) * t;
    const rr = 10, half = rr * Math.tan(10 * Math.PI / 180);
    if (Math.abs(x - 40) < half) return 5 + (x - 40 + half) ** 2 / (4 * half) * t;
    return lin;
  }), { undercut: false });

  // handles, grips, hoods
  const halfEllipse = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => [a + a * Math.cos(Math.PI * i / n), b * Math.sin(Math.PI * i / n)]);
  frc('handle: half-ellipse grip 120 long, 30 high, 25 wide', rollX(prism(halfEllipse(60, 30, 48), 25)), { undercut: false });
  frc('grip with four finger dips', block(axis(110, 0.5), axis(28, 0.5), (x, y) => (18 - 3 * Math.max(0, Math.sin(Math.PI * x / 27.5)) ** 2) * Math.sqrt(Math.max(0.05, 1 - ((y - 14) / 14) ** 2 * 0.6))), { undercut: false });
  frc('hood plate with an R300 curved top, 200x15', block(axis(200, 1), axis(15, 3), x => 20 + Math.sqrt(300 * 300 - (x - 100) ** 2) - 300 + 17), { undercut: false });
  frc('shooter hood rib: thin 4 mm arch', block(axis(160, 1), axis(4, 1), x => 6 + 30 * Math.sin(Math.PI * x / 160)), { undercut: false });
  frc('curved hood band (an arch, hollow underneath)', rollX(prism([...arc(0, 0, 60, 0.3, Math.PI - 0.3, 40), ...arc(0, 0, 56, Math.PI - 0.3, 0.3, 40)], 30)), {});
  frc('bumper corner block, 10 mm round on top', block(axis(60, 0.5), axis(60, 0.5), rounded(60, 60, 25, 10)), { undercut: false });
  frc('belly pan rib, 6 wide with a round top', block(axis(150, 5), axis(6, 0.25), (x, y) => 8 + Math.sqrt(Math.max(0, 9 - (y - 3) ** 2))), { undercut: false });

  // round parts
  frc('crowned pulley, 40 dia, crown 0.5 mm', revolve([R(0, 20), R(19.5, 20), ...Array.from({ length: 21 }, (_, i) => R(19.5 + 0.5 * Math.sin(Math.PI * i / 20), 20 - i)), R(19.5, 0), R(0, 0)].filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]), 120), { undercut: true });
  frc('flanged pulley, 30 dia, 4 mm flanges', revolve([R(0, 20), R(18, 20), R(18, 17), R(15, 17), R(15, 3), R(18, 3), R(18, 0), R(0, 0)], 120), { undercut: true });
  frc('wheel hub with a 12.7 bore, 2 mm chamfer on top', revolve([R(6.35, 15), R(16, 15), R(18, 13), R(18, 5), R(30, 5), R(30, 0), R(6.35, 0), R(6.35, 15)], 120), { undercut: false });
  frc('hub with a domed cap', revolve([R(0, 22), ...arc(0, 12, 10, Math.PI / 2, 0, 16).slice(1).map(([r, z]) => R(r, z)), R(25, 12), R(25, 0), R(0, 0)], 120), { undercut: false });
  frc('spacer, 1/2" bore, chamfered both ends', revolve([R(6.5, 20), R(10, 20), R(11, 19), R(11, 1), R(10, 0), R(6.5, 0), R(6.5, 20)], 96), { undercut: true });
  frc('tapered standoff', revolve([R(2.5, 25), R(5, 25), R(9, 0), R(2.5, 0), R(2.5, 25)], 96), { undercut: false });
  frc('swerve cover: 80 dia shallow dome, 12 high', revolve([R(0, 12), ...Array.from({ length: 32 }, (_, i) => {
    const Rs = (40 * 40 + 144) / 24, a = Math.asin(40 / Rs) * (i + 1) / 32;
    return R(Rs * Math.sin(a), 12 - Rs * (1 - Math.cos(a)));
  }), R(0, 0)], 160), { undercut: false });
  frc('knob: domed top, eight grip ribs', disk(20, (r, a) => 14 + 3 * Math.sqrt(Math.max(0, 1 - (r / 20) ** 2)) - (r > 15 ? 2 * Math.max(0, Math.cos(8 * a)) ** 4 * (r - 15) / 5 : 0), 40, 160), { undercut: false });
  frc('knob: star outline, rounded top', (() => {
    const pts = Array.from({ length: 80 }, (_, i) => {
      const a = 2 * Math.PI * i / 80, r = 18 + 3 * Math.cos(5 * a);
      return [r * Math.cos(a), r * Math.sin(a)];
    });
    return prism(pts, 12);
  })(), { undercut: false, prism: true });
  frc('sprocket hub boss with a fillet', revolve([R(4, 18), R(10, 18), ...arc(13, 8, 3, Math.PI, 1.5 * Math.PI, 8).map(([r, z]) => R(r, z)), R(28, 5), R(28, 0), R(4, 0), R(4, 18)], 120), { undercut: false });
  frc('shaft collar style ring, 1 mm chamfers', revolve([R(8, 10), R(15, 10), R(16, 9), R(16, 1), R(15, 0), R(8, 0), R(8, 10)], 120), { undercut: true });
  frc('limit switch cam, eccentric', (() => {
    const pts = Array.from({ length: 72 }, (_, i) => {
      const a = 2 * Math.PI * i / 72, r = 15 + 6 * Math.max(0, Math.cos(a)) ** 2;
      return [r * Math.cos(a), r * Math.sin(a)];
    });
    return prism(pts, 8);
  })(), { undercut: false, prism: true });
  frc('turret ring, rounded top', revolve([...Array.from({ length: 31 }, (_, i) => {
    const r = 45 + 15 * i / 30;
    return R(r, 6 + 3.6 * Math.sqrt(Math.max(0, 1 - ((r - 52.5) / 7.5) ** 2)));
  }), R(60, 0), R(45, 0), R(45, 6)], 200), { undercut: false });

  // guides and brackets
  frc('cable guide: U channel with a round floor', block(axis(30, 0.3), axis(40, 5), x => (Math.abs(x - 15) < 9 ? 11 - Math.sqrt(81 - (x - 15) ** 2) : 20)), { undercut: false });
  frc('cable guide with a flared mouth', block(axis(60, 0.5), axis(30, 0.5), (x, y) => {
    const half = 5 + 6 * Math.max(0, (10 - x) / 10) ** 2, d = Math.abs(y - 15);
    return d < half ? 4 + 0 : 14;
  }), { undercut: false });
  frc('gusset with a filleted inside corner', prism([[0, 0], [60, 0], [60, 8], ...arc(20, 20, 12, -Math.PI / 2, -Math.PI, 12), [8, 60], [0, 60]], 6), { undercut: false, prism: true });
  frc('battery cradle with a cylindrical trough', block(axis(70, 0.5), axis(40, 4), x => {
    const q = 900 - (x - 35) ** 2;
    return q > 0 ? Math.min(20, Math.max(4, 34 - Math.sqrt(q))) : 20;
  }), { undercut: false });
  frc('camera mount: dome on a plate', block(axis(60, 0.5), axis(60, 0.5), (x, y) => {
    const q = 225 - (x - 30) ** 2 - (y - 30) ** 2;
    return q > 0 ? 5 + Math.sqrt(q) : 5;
  }), { undercut: false });
  frc('plate with six domed bosses', block(axis(100, 0.5), axis(60, 0.5), (x, y) => {
    let z = 6;
    for (const cx of [20, 50, 80]) for (const cy of [18, 42]) {
      const q = 36 - (x - cx) ** 2 - (y - cy) ** 2;
      if (q > 0) z = Math.max(z, 6 + Math.sqrt(q));
    }
    return z;
  }), { undercut: false });
  frc('knurled grip pad (2 mm pyramids)', block(axis(50, 0.5), axis(30, 0.5), (x, y) => 8 + 1 - Math.max(Math.abs((x % 2) - 1), Math.abs((y % 2) - 1))), { undercut: false });

  // numbers and logos
  frc('"2854" raised 1.5 mm on a 100x40 plate', block(axis(100, 0.4), axis(40, 0.4), (() => {
    const d = textDistance('2854', 8, 8, 24); return (x, y) => 6 + 1.5 * smooth(1.5 - d(x, y), 0.25);
  })()), { undercut: false });
  frc('"2854" cut 1 mm into a 100x40 plate', block(axis(100, 0.4), axis(40, 0.4), (() => {
    const d = textDistance('2854', 8, 8, 24); return (x, y) => 6 - 1 * smooth(1.5 - d(x, y), 0.25);
  })()), { undercut: false });
  frc('"2854" engraved with a round-bottom groove', block(axis(100, 0.4), axis(40, 0.4), (() => {
    const d = textDistance('2854', 8, 8, 24); return (x, y) => 6 - 1.5 * Math.sqrt(Math.max(0, 1 - (d(x, y) / 2) ** 2));
  })()), { undercut: false });
  frc('"FRC" raised with rounded strokes', block(axis(80, 0.4), axis(36, 0.4), (() => {
    const d = textDistance('FRC', 6, 6, 24); return (x, y) => 5 + 2 * Math.sqrt(Math.max(0, 1 - (d(x, y) / 2) ** 2));
  })()), { undercut: false });
  frc('"UP" label, small 8 mm letters', block(axis(30, 0.2), axis(16, 0.2), (() => {
    const d = textDistance('UP', 4, 4, 8); return (x, y) => 4 + 0.8 * smooth(0.6 - d(x, y), 0.2);
  })()), { undercut: false, flatNicks: true });
  frc('logo: domed star boss', block(axis(80, 0.4), axis(80, 0.4), (x, y) => {
    const a = Math.atan2(y - 40, x - 40), r = Math.hypot(x - 40, y - 40), edge = 22 + 10 * Math.cos(5 * a);
    return r < edge ? 6 + 8 * Math.sqrt(Math.max(0, 1 - (r / edge) ** 2)) : 6;
  }), { undercut: false });
  frc('logo: waves inside a circle', block(axis(80, 0.5), axis(80, 0.5), (x, y) => {
    const r = Math.hypot(x - 40, y - 40);
    return r < 35 ? 6 + 1.5 * (1 + Math.sin(x / 4 + 2 * Math.sin(y / 9))) : 6;
  }), { undercut: false });
  frc('team medallion: 2854 on a domed disk', (() => {
    const d = textDistance('2854', -22, -6, 12);
    return disk(30, (r, a) => 8 + 4 * Math.sqrt(Math.max(0, 1 - (r / 30) ** 2)) + 1 * smooth(1 - d(r * Math.cos(a), r * Math.sin(a)), 0.25), 90, 360);
  })(), { undercut: false });

  // a few more everyday ones
  frc('motor plate with a spot face and rounded edges', block(axis(70, 0.5), axis(70, 0.5), (x, y) => {
    const r = Math.hypot(x - 35, y - 35);
    return Math.min(rounded(70, 70, 10, 2)(x, y), r < 12 ? 8 : 10);
  }), { undercut: false });
  frc('standoff block with a domed top', block(axis(30, 0.4), axis(30, 0.4), (x, y) => 8 + 6 * Math.sqrt(Math.max(0, 1 - ((x - 15) ** 2 + (y - 15) ** 2) / 225))), { undercut: false });
  frc('wrist plate: round pocket with a sloped wall', disk(35, r => (r < 20 ? 6 : r < 26 ? 6 + (r - 20) : 12), 70, 160), { undercut: false });
  frc('arm tip: stadium outline, flat bar', prism([...arc(85, 15, 15, -Math.PI / 2, Math.PI / 2, 24), [0, 30], [0, 0]], 10), { undercut: false, prism: true });
  frc('chute with a curved floor', block(axis(50, 0.4), axis(60, 6), x => (Math.abs(x - 25) < 20 ? Math.max(5, 25 - Math.sqrt(400 - (x - 25) ** 2)) : 25)), { undercut: false });
  frc('note deflector: shallow S curve, 150x40', block(axis(150, 1), axis(40, 5), x => 10 + 6 * Math.sin(2 * Math.PI * x / 150)), { undercut: false });
  frc('climber hook block with a round notch', block(axis(60, 0.5), axis(25, 5), x => {
    const q = 64 - (x - 30) ** 2;
    return q > 0 ? 22 - Math.sqrt(q) : 22;
  }), { undercut: false });
  frc('sloped bracket, 30 degree face with rounded corners', block(axis(70, 0.5), axis(40, 0.5), (x, y) => Math.min(rounded(70, 40, 30, 4)(x, y), 8 + x * Math.tan(Math.PI / 6))), { undercut: false });
  frc('tray with a 5 mm round inside', block(axis(120, 0.5), axis(80, 0.5), (x, y) => {
    const e = Math.min(x, 120 - x, y, 80 - y) - 4; // the wall is 4 thick
    if (e <= 0) return 15;
    return 8 - Math.sqrt(Math.max(0, 25 - Math.max(0, 5 - e) ** 2));
  }), { undercut: false });
  frc('cone-shaped centering pin, 20 tall', revolve([R(0, 20), R(3, 17), R(6, 5), R(10, 5), R(10, 0), R(0, 0)], 96), { undercut: false });

  // ---- crazy ones
  crazy('egg crate, 8 mm high, 20 mm period', block(axis(100, 0.75), axis(100, 0.75), (x, y) => 12 + 4 * Math.sin(2 * Math.PI * x / 20) * Math.sin(2 * Math.PI * y / 20)), { undercut: false });
  crazy('fine egg crate, 4 mm period (smaller than the ball)', block(axis(40, 0.25), axis(40, 0.25), (x, y) => 6 + 1 * Math.sin(2 * Math.PI * x / 4) * Math.sin(2 * Math.PI * y / 4)), { undercut: false });
  crazy('terrain 150x150', block(axis(150, 1), axis(150, 1), (() => { const n = noise(7); return (x, y) => 18 + 6 * n(x, y); })()), { undercut: false });
  crazy('ridged terrain, sharp peaks', block(axis(120, 0.75), axis(120, 0.75), (() => { const n = noise(11); return (x, y) => 6 + 14 * (1 - Math.abs(n(x, y)) / 2.5); })()), { undercut: false });
  crazy('spiral ramp with a 10 mm step', disk(40, (r, a) => 5 + 10 * ((a + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * Math.min(1, r / 5), 40, 240), { undercut: false });
  crazy('double helix ramp', disk(40, (r, a) => 5 + 8 * (0.5 + 0.5 * Math.sin(2 * a + r / 4)), 50, 240), { undercut: false });
  crazy('fins 0.8 mm wide, 15 mm tall', block(axis(60, 0.5), axis(40, 0.2), (x, y) => ((y % 8) > 3.6 && (y % 8) < 4.4 ? 20 : 5)), { undercut: false });
  crazy('thin round wall, 0.6 mm', revolve([R(20, 15), R(20.6, 15), R(20.6, 0), R(20, 0), R(20, 15)], 160), { undercut: false });
  crazy('pins 1 mm across, 10 tall', block(axis(24, 0.2), axis(24, 0.2), (x, y) => ((Math.hypot((x % 8) - 4, (y % 8) - 4) < 0.5) ? 15 : 5)), { undercut: false });
  crazy('tiny bumps, 0.5 mm', block(axis(20, 0.1), axis(10, 0.1), (x, y) => 4 + 0.25 * (1 + Math.cos(2 * Math.PI * x / 1) * Math.cos(2 * Math.PI * y / 1))), { undercut: false });
  crazy('dome right at the Z limit', block(axis(80, 1), axis(80, 1), (x, y) => Math.sqrt(Math.max(0, 54 ** 2 - (x - 40) ** 2 - (y - 40) ** 2)) - 54 + 54.4 - 0.1 * 0 + 0), { undercut: false });
  crazy('tower too tall any way up (70 cube)', block(axis(70, 7), axis(70, 7), () => 70), { expect: 'refuse' });
  crazy('tall rod 120 long, 20 thick: lies down', revolve([R(0, 120), R(10, 120), R(10, 0), R(0, 0)], 64), { undercut: true });
  crazy('needle: cone 1 mm across, 30 tall', revolve([R(0, 30), R(1, 0), R(0, 0)], 48), {});
  crazy('pyramid with 89 degree walls', block(axis(40, 0.25), axis(40, 0.25), (x, y) => 2 + clamp((15 - Math.max(Math.abs(x - 20), Math.abs(y - 20))) * 57, 0, 38)), { undercut: false });
  crazy('hook drawn standing, overhang on one side', rollX(prism([[0, 0], [10, 0], [10, 25], [25, 25], [25, 30], [0, 30]], 20)), { undercut: false });
  crazy('T-slot block drawn lying, overhang inside', rollX(prism([[0, 0], [40, 0], [40, 20], [26, 20], [26, 14], [32, 14], [32, 8], [8, 8], [8, 14], [14, 14], [14, 20], [0, 20]], 30)), { undercut: false });
  crazy('mushroom', revolve([R(0, 15), R(15, 15), R(15, 10), R(8, 10), R(8, 0), R(0, 0)], 96), { undercut: false });
  crazy('torus, 30 across', revolve(arc(10, 5, 5, Math.PI / 2, Math.PI / 2 - 2 * Math.PI, 40).map(([r, z]) => R(r, z)), 96), { undercut: true });
  crazy('ball R20', revolve(arc(0, 20, 20, Math.PI / 2, -Math.PI / 2, 48).map(([r, z]) => R(Math.abs(r) < 1e-9 ? 0 : r, z)), 96), { undercut: true });
  crazy('too big for the machine, 400 x 600', block(axis(400, 20), axis(600, 20), (x, y) => 10 + 5 * Math.sin(x / 50) * Math.sin(y / 50)), { expect: 'refuse' });
  crazy('long part, only fits turned (500 x 150)', block(axis(500, 5), axis(150, 5), (x, y) => 8 + 3 * Math.sin(x / 40) * Math.cos(y / 30)), {});
  crazy('micro part, 3 x 3 x 1', block(axis(3, 0.1), axis(3, 0.1), (x, y) => 1 - 0.3 * ((x - 1.5) ** 2 + (y - 1.5) ** 2) / 4.5), {});
  crazy('nearly flat: 0.1 mm relief', block(axis(60, 1), axis(40, 1), (x, y) => 5 + 0.05 * Math.sin(x / 3) * Math.sin(y / 3)), { undercut: false });
  crazy('far from the origin (5 m away)', move(block(axis(40, 0.5), axis(40, 0.5), rounded(40, 40, 12, 6)), 5000, -3000, 2000), { undercut: false });
  crazy('drawn tilted 30 degrees', tilt(block(axis(50, 1), axis(30, 1), rounded(50, 30, 10, 4)), 30), {});
  crazy('drawn on its side', tipOver(block(axis(60, 0.5), axis(40, 0.5), rounded(60, 40, 15, 5))), { undercut: false });
  crazy('two separate domes', [...revolve([R(0, 10), ...arc(0, 0, 10, Math.PI / 2, 0, 16).slice(1), R(0, 0)], 64), ...move(revolve([R(0, 10), ...arc(0, 0, 10, Math.PI / 2, 0, 16).slice(1), R(0, 0)], 64), 40, 0, 0)], {});
  crazy('two overlapping domes', [...revolve([R(0, 15), ...arc(0, 0, 15, Math.PI / 2, 0, 20).slice(1), R(0, 0)], 64), ...move(revolve([R(0, 15), ...arc(0, 0, 15, Math.PI / 2, 0, 20).slice(1), R(0, 0)], 64), 18, 0, 0)], {});
  crazy('deep narrow well, 3 mm across, 20 deep', block(axis(30, 0.2), axis(30, 0.2), (x, y) => (Math.hypot(x - 15, y - 15) < 1.5 ? 5 : 25)), { undercut: false });
  crazy('sawtooth, sharp 6 mm steps', block(axis(90, 0.25), axis(30, 5), x => 4 + 6 * ((x % 15) / 15)), { undercut: false });
  crazy('ziggurat, 12 floors', block(axis(80, 0.5), axis(80, 0.5), (x, y) => 2 + 2 * Math.floor(Math.min(12, (40 - Math.max(Math.abs(x - 40), Math.abs(y - 40))) / 3))), { undercut: false });
  crazy('checkerboard of heights', block(axis(80, 0.5), axis(80, 0.5), (x, y) => 4 + 3 * ((Math.floor(x / 10) * 7 + Math.floor(y / 10) * 3) % 5)), { undercut: false, flatNicks: true });
  crazy('spiky noise', block(axis(60, 0.4), axis(60, 0.4), (x, y) => 8 + 3 * Math.sin(x * 1.7) * Math.cos(y * 2.3) + 2 * Math.sin(x * 0.37 + y * 0.91)), { undercut: false });
  crazy('ripples (sinc)', disk(50, r => 10 + 6 * (r < 0.01 ? 1 : Math.sin(r / 2) / (r / 2)), 100, 200), { undercut: false });

  // broken meshes
  const base = () => block(axis(50, 1), axis(40, 1), (x, y) => 8 + 4 * Math.sin(Math.PI * x / 50) * Math.sin(Math.PI * y / 40));
  crazy('broken: zero-area triangles mixed in', (() => {
    const t = base(); const out = [];
    t.forEach((x, i) => { out.push(x); if (i % 7 === 0) out.push([x[0], x[0], x[1]]); if (i % 11 === 0) out.push([x[0], x[1], [(x[0][0] + x[1][0]) / 2, (x[0][1] + x[1][1]) / 2, (x[0][2] + x[1][2]) / 2]]); });
    return out;
  })(), { undercut: false });
  // with no bottom it can't tell which way is up, and may well cut it upside down
  crazy('broken: open mesh, no bottom', base().filter(t => !t.every(p => p[2] === 0)), {});
  crazy('broken: open mesh, a wall missing', base().filter(t => !t.every(p => p[1] === 0)), {});
  crazy('broken: every face twice', base().flatMap(t => [t, t]), { undercut: false });
  crazy('broken: half the faces wound backwards', base().map((t, i) => (i % 2 ? [t[0], t[2], t[1]] : t)), {});
  crazy('broken: a soup of slivers', (() => {
    const out = base(); let s = 3;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2000; i++) {
      const x = 5 + 40 * rnd(), y = 5 + 30 * rnd(), z = 2 + 5 * rnd();
      out.push([[x, y, z], [x + 0.001, y, z], [x, y + 3 * rnd(), z + 0.0001]]);
    }
    return out;
  })(), {});
  crazy('broken: NaN in a corner', (() => { const t = base(); t[5] = [[NaN, 0, 0], t[5][1], t[5][2]]; return t; })(), { expect: 'refuse' });
  crazy('broken: no triangles', [], { expect: 'refuse' });
  crazy('broken: one lonely triangle', [[[0, 0, 0], [10, 0, 0], [0, 10, 5]]], { expect: 'refuse' });
  crazy('huge mesh: dome with ~300k triangles', block(axis(80, 0.2), axis(80, 0.2), (x, y) => {
    const q = 1600 - (x - 40) ** 2 - (y - 40) ** 2; return q > 0 ? 3 + Math.sqrt(q) * 0.5 : 3;
  }), { undercut: false });
  return list;
}
