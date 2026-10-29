// 3D test parts as triangle meshes, handed over the way compactMesh does it: one flat list of
// corners in metres, each triangle wound anticlockwise seen from outside. Each part also comes
// with its exact top surface, height(x, y) in mm (-Infinity off the part), to check the cuts against.

const m = v => v / 1000;

function solid(tris, height) {
  const triangles = [];
  for (const t of tris) for (const p of t) triangles.push(...p.map(m));
  let minX = Infinity, minY = Infinity, maxZ = -Infinity;
  for (const t of tris) for (const [x, y, z] of t) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxZ = Math.max(maxZ, z); }
  return { mesh: { triangles }, height, corner: [minX, minY, maxZ] };
}

// Adds a triangle, turned round if it doesn't face along `out`.
function tri(list, a, b, c, out) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (Math.hypot(...n) < 1e-12) return;
  list.push(n[0] * out[0] + n[1] * out[1] + n[2] * out[2] >= 0 ? [a, b, c] : [a, c, b]);
}

// A profile in (r, z), from the top of the axis round the outside to the bottom of the axis, spun
// round the Z axis in `n` steps.
export function revolve(profile, n = 96) {
  const tris = [];
  const at = ([r, z], k) => [r * Math.cos(2 * Math.PI * k / n), r * Math.sin(2 * Math.PI * k / n), z];
  for (let i = 0; i + 1 < profile.length; i++) {
    const [r0, z0] = profile[i], [r1, z1] = profile[i + 1];
    for (let k = 0; k < n; k++) {
      const mid = 2 * Math.PI * (k + 0.5) / n;
      const out = [-(z1 - z0) * Math.cos(mid), -(z1 - z0) * Math.sin(mid), r1 - r0];
      const a = at(profile[i], k), b = at(profile[i], k + 1), c = at(profile[i + 1], k + 1), d = at(profile[i + 1], k);
      if (r0 > 1e-9) tri(tris, a, b, c, out);
      if (r1 > 1e-9) tri(tris, a, c, d, out);
    }
  }
  return tris;
}

// A profile in (x, z), anticlockwise, pushed out along Y from 0 to `w`, with flat ends. The ends
// are fans from the middle, so a profile that isn't convex has to give its ends as convex pieces.
export function extrude(profile, w, ends = [profile]) {
  const tris = [];
  profile.forEach(([x0, z0], i) => {
    const [x1, z1] = profile[(i + 1) % profile.length];
    const out = [z1 - z0, 0, -(x1 - x0)];
    tri(tris, [x0, 0, z0], [x1, 0, z1], [x1, w, z1], out);
    tri(tris, [x0, 0, z0], [x1, w, z1], [x0, w, z0], out);
  });
  for (const end of ends) {
    const cx = end.reduce((s, p) => s + p[0], 0) / end.length, cz = end.reduce((s, p) => s + p[1], 0) / end.length;
    end.forEach(([x0, z0], i) => {
      const [x1, z1] = end[(i + 1) % end.length];
      tri(tris, [cx, 0, cz], [x0, 0, z0], [x1, 0, z1], [0, -1, 0]);
      tri(tris, [cx, w, cz], [x0, w, z0], [x1, w, z1], [0, 1, 0]);
    });
  }
  return tris;
}

// A hemisphere of radius R sitting on its flat face.
export function dome(R = 25, steps = 48) {
  const profile = [];
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI / 2 * i / steps;
    profile.push([R * Math.sin(a), R * Math.cos(a)]);
  }
  profile.push([0, 0]);
  return solid(revolve(profile, 192), (x, y) => {
    const q = R * R - x * x - y * y;
    return q > 0 ? Math.sqrt(q) : -Infinity;
  });
}

// A cone, point up.
export function cone(R = 20, h = 25) {
  const profile = [[0, h]];
  for (let i = 1; i <= 8; i++) profile.push([R * i / 8, h * (1 - i / 8)]);
  profile.push([0, 0]);
  return solid(revolve(profile, 192), (x, y) => {
    const r = Math.hypot(x, y);
    return r < R ? h * (1 - r / R) : -Infinity;
  });
}

// A block 60 x 40 whose top slopes from 5 mm high at X0 to 20 mm at X60.
export function wedge() {
  return solid(extrude([[0, 0], [60, 0], [60, 20], [0, 5]], 40), (x, y) => (x > 0 && x < 60 && y > 0 && y < 40 ? 5 + 15 * x / 60 : -Infinity));
}

// A 50 x 40 x 20 block with its top edge along X50 rounded off, radius 8.
export function fillet(r = 8) {
  const profile = [[0, 0], [50, 0], [50, 20 - r]];
  for (let i = 1; i < 24; i++) {
    const a = Math.PI / 2 * i / 24;
    profile.push([50 - r + r * Math.cos(a), 20 - r + r * Math.sin(a)]);
  }
  profile.push([50 - r, 20], [0, 20]);
  return solid(extrude(profile, 40), (x, y) => {
    if (x <= 0 || x >= 50 || y <= 0 || y >= 40) return -Infinity;
    return x <= 50 - r ? 20 : 20 - r + Math.sqrt(Math.max(0, r * r - (x - 50 + r) ** 2));
  });
}

// A 40 x 50 x 20 block with a groove 4 mm wide and 6 mm deep down the middle, narrower than a 1/4"
// roughing bit. `along` runs it along X, the way the finish goes; otherwise it runs along Y.
export function groove(along = true) {
  const top = (x, y) => (x > 0 && x < 40 && y > 0 && y < 50 ? (x > 18 && x < 22 ? 14 : 20) : -Infinity);
  const tris = extrude([[0, 0], [40, 0], [40, 20], [22, 20], [22, 14], [18, 14], [18, 20], [0, 20]], 50,
    [[[0, 0], [18, 0], [18, 20], [0, 20]], [[18, 0], [22, 0], [22, 14], [18, 14]], [[22, 0], [40, 0], [40, 20], [22, 20]]]);
  if (!along) return solid(tris, top);
  // swapping X and Y mirrors it, so each triangle gets wound the other way round too
  return solid(tris.map(t => [t[0], t[2], t[1]].map(([x, y, z]) => [y, x, z])), (x, y) => top(y, x));
}

// A mushroom: a 15 mm radius cap, 5 mm thick, on an 8 mm radius stem 10 mm tall. Upright the
// underside of the cap can't be reached, so it gets cut upside down: the stem's end on top at 15,
// the cap's back at 5 all round it. (Turned over about X, so Y flips too, which a round part doesn't mind.)
export function mushroom() {
  const shape = solid(revolve([[0, 15], [15, 15], [15, 10], [8, 10], [8, 0], [0, 0]], 96), () => -Infinity);
  shape.height = (x, y) => {
    const r = Math.hypot(x, y);
    return r < 8 ? 15 : r < 15 ? 5 : -Infinity;
  };
  return shape;
}

// A ball. Whichever way up it goes, its bottom half is hidden. At 70 mm across it's taller than
// the machine's Z can cut.
export function ball(R = 12, steps = 48) {
  const profile = [];
  for (let i = 0; i <= steps; i++) profile.push([R * Math.sin(Math.PI * i / steps), R * Math.cos(Math.PI * i / steps)]);
  return solid(revolve(profile, 2 * steps), (x, y) => {
    const q = R * R - x * x - y * y;
    return q > 0 ? Math.sqrt(q) : -Infinity;
  });
}
