// Reads a part's triangle mesh (Onshape's tessellatedfaces) for a 3D cut from the top: picks the
// side to face up, squares it to the stock, and works out its outline seen from above, a height
// map, and the undercuts a cut from the top can't reach. Also drops a ball-nose bit onto it.

import { SCALE, toInt, union, offset, pieces, bounds, area, totalArea, scanline } from './geom.js';
import { PartError, closeGaps, squaringAngle } from './part.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l); };

// The triangles out of Onshape's reply, as one flat list of corners in metres (x, y, z, x, y, z, ...),
// each one wound anticlockwise seen from outside the part.
export function compactMesh(reply) {
  const bodies = Array.isArray(reply) ? reply : reply?.bodies || [];
  const vec = p => (Array.isArray(p) ? p : p && [p.x, p.y, p.z]);
  const out = [];
  for (const body of bodies) {
    const table = (body.facetPoints || reply.facetPoints || []).map(vec);
    for (const face of body.faces || []) {
      for (const f of face.facets || []) {
        const pts = f.vertices?.length ? f.vertices.map(vec) : (f.indices || []).map(i => table[i]);
        if (pts.length < 3 || pts.some(p => !p || p.some(v => typeof v !== 'number'))) continue;
        for (let k = 1; k + 1 < pts.length; k++) {
          let t = [pts[0], pts[k], pts[k + 1]];
          if (f.normal && dot(cross(sub(t[1], t[0]), sub(t[2], t[0])), vec(f.normal)) < 0) t = [t[0], t[2], t[1]];
          out.push(...t[0], ...t[1], ...t[2]);
        }
      }
    }
  }
  return { triangles: out };
}

// Which side faces up. Onshape's own up comes first, and only loses to a side that hides less.
const SIDES = [
  { up: [0, 0, 1] },
  { up: [0, 0, -1], note: 'It\'s cut upside down from how it\'s drawn in Onshape, so less of it is hidden underneath.' },
  ...[['+Y', [0, 1, 0]], ['-Y', [0, -1, 0]], ['+X', [1, 0, 0]], ['-X', [-1, 0, 0]]].map(([name, up]) => ({
    up, note: `It's cut lying on its side, with its ${name} side up, so less of it is hidden underneath.`,
  })),
];

// `maxHeight` is the tallest part the machine can cut. A side that fits wins over one that doesn't.
export function readSolid(mesh, maxHeight = Infinity) {
  const raw = mesh?.triangles;
  if (!raw || raw.length < 36 || raw.length % 9) throw new PartError('Onshape sent back no surface for that part, so it can\'t be cut in 3D.');
  const mm = Float64Array.from(raw, v => v * 1000);
  if (mm.some(v => !isFinite(v))) throw new PartError('The surface Onshape sent back for that part has bad numbers in it.');

  let volume = 0;
  for (let k = 0; k < mm.length; k += 9) volume += dot(mm.subarray(k, k + 3), cross(mm.subarray(k + 3, k + 6), mm.subarray(k + 6, k + 9))) / 6;
  const looks = SIDES.map(side => ({ side, ...look(placed(mm, side.up)) }));
  const fitting = looks.filter(l => l.height <= maxHeight);
  const pick = (fitting.length ? fitting : looks).reduce((best, l) => (l.under < best.under - Math.max(1, 0.01 * Math.abs(volume)) ? l : best));
  const notes = pick.side.note ? [pick.side.note] : [];
  const tris = placed(mm, pick.side.up);

  // turned square to the stock, like a flat part
  const corners = [];
  for (let k = 0; k < tris.length; k += 3) corners.push({ X: Math.round(tris[k] * SCALE), Y: Math.round(tris[k + 1] * SCALE) });
  const angle = squaringAngle([corners]);
  if (angle) {
    turn(tris, -angle);
    notes.push(`The part is turned ${Math.round(angle * 180 / Math.PI)} degrees so its edges line up with the stock.`);
  }
  return build(tris, notes);
}

// A part turned a quarter turn, for when it only fits on the machine the other way round.
export function quarterTurn(solid) {
  const tris = Float64Array.from(solid.tris);
  turn(tris, Math.PI / 2);
  return build(tris, [...solid.notes, 'The part is turned a quarter turn so it fits on the machine.']);
}

function turn(tris, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let k = 0; k < tris.length; k += 3) {
    const x = tris[k], y = tris[k + 1];
    tris[k] = x * c - y * s;
    tris[k + 1] = x * s + y * c;
  }
}

// The corners turned so `up` points up the Z axis, in a right-handed frame so the part is never
// cut mirrored.
function placed(mm, up) {
  const helper = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(helper.map((v, i) => v - dot(helper, up) * up[i]));
  const v = cross(up, u);
  const tris = new Float64Array(mm.length);
  for (let k = 0; k < mm.length; k += 3) {
    const p = mm.subarray(k, k + 3);
    tris[k] = dot(p, u); tris[k + 1] = dot(p, v); tris[k + 2] = dot(p, up);
  }
  return tris;
}

// The volume under a rough height map of the part (mm³), down to its bottom, and how tall it is.
// A cut from the top leaves all of that volume solid, so less of it is less left under overhangs
// (the part's own volume is the same any way up).
function look(tris) {
  const pts = [];
  let lo = Infinity, hi = -Infinity, uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (let k = 0; k < tris.length; k += 3) {
    const q = [tris[k], tris[k + 1], tris[k + 2]];
    pts.push(q);
    lo = Math.min(lo, q[2]); hi = Math.max(hi, q[2]);
    uMin = Math.min(uMin, q[0]); uMax = Math.max(uMax, q[0]); vMin = Math.min(vMin, q[1]); vMax = Math.max(vMax, q[1]);
  }
  const res = Math.max(0.25, Math.sqrt((uMax - uMin) * (vMax - vMin) / 40000));
  const nx = Math.ceil((uMax - uMin) / res) + 1, ny = Math.ceil((vMax - vMin) / res) + 1;
  const top = new Float64Array(nx * ny).fill(-Infinity);
  // cell middles only: an upright wall covers none, so it adds nothing it shouldn't
  const mark = (x, y, h) => {
    const k = Math.min(ny - 1, Math.floor((y - vMin) / res)) * nx + Math.min(nx - 1, Math.floor((x - uMin) / res));
    if (h > top[k]) top[k] = h;
  };
  for (let k = 0; k < pts.length; k += 3) {
    const [a, b, c] = [pts[k], pts[k + 1], pts[k + 2]];
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(det) < 1e-12) continue;
    for (let j = Math.floor((Math.min(a[1], b[1], c[1]) - vMin) / res); j <= Math.floor((Math.max(a[1], b[1], c[1]) - vMin) / res); j++) {
      const y = vMin + (j + 0.5) * res;
      for (let i = Math.floor((Math.min(a[0], b[0], c[0]) - uMin) / res); i <= Math.floor((Math.max(a[0], b[0], c[0]) - uMin) / res); i++) {
        const x = uMin + (i + 0.5) * res;
        const s = ((x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1])) / det;
        const t = ((b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1])) / det;
        if (s >= 0 && t >= 0 && s + t <= 1) mark(x, y, a[2] + s * (b[2] - a[2]) + t * (c[2] - a[2]));
      }
    }
  }
  let under = 0;
  for (const h of top) if (h > -Infinity) under += (h - lo) * res * res;
  return { under, height: hi - lo };
}

// Everything else, once the part sits square with its top at Z0 and its front left corner at X0 Y0.
function build(tris, notes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < tris.length; k += 3) {
    minX = Math.min(minX, tris[k]); maxX = Math.max(maxX, tris[k]);
    minY = Math.min(minY, tris[k + 1]); maxY = Math.max(maxY, tris[k + 1]);
    minZ = Math.min(minZ, tris[k + 2]); maxZ = Math.max(maxZ, tris[k + 2]);
  }
  for (let k = 0; k < tris.length; k += 3) {
    tris[k] -= minX; tris[k + 1] -= minY; tris[k + 2] -= maxZ;
  }
  const height = maxZ - minZ;
  const size = { x: maxX - minX, y: maxY - minY };
  if (height < 0.05 || size.x < 0.05 || size.y < 0.05) throw new PartError('That part is too thin to cut.');

  const silhouette = shadow(tris, () => true);
  if (!silhouette.length) throw new PartError('That part has no area to cut.');
  const map = heightMap(tris, size);

  // Faces looking down, above the bottom, can't be reached from the top. Seen from above, the
  // cut leaves everything under them solid.
  const facing = k => {
    const ax = tris[k], ay = tris[k + 1];
    const nz = (tris[k + 3] - ax) * (tris[k + 7] - ay) - (tris[k + 4] - ay) * (tris[k + 6] - ax);
    const len = Math.hypot(...cross(sub(tris.subarray(k + 3, k + 6), tris.subarray(k, k + 3)), sub(tris.subarray(k + 6, k + 9), tris.subarray(k, k + 3))));
    return len > 0 ? nz / len : 0;
  };
  const above = k => Math.max(tris[k + 2], tris[k + 5], tris[k + 8]) > -height + 0.05;
  const undercuts = pieces(shadow(tris, k => facing(k) < -0.02 && above(k)))
    .map(p => ({ area: totalArea([p.outer, ...p.holes]), where: bounds([p.outer]) }))
    .filter(p => p.area > 0.5);

  // Flat faces looking up. Roughing stops just above each one rather than somewhere below it.
  const flat = new Map();
  for (let k = 0; k < tris.length; k += 9) {
    if (facing(k) < 1 - 1e-7) continue; // truly flat: a curved face has facets that only nearly are
    const h = +tris[k + 2].toFixed(2);
    const a = Math.abs(area(toInt([[tris[k], tris[k + 1]], [tris[k + 3], tris[k + 4]], [tris[k + 6], tris[k + 7]]])));
    flat.set(h, (flat.get(h) || 0) + a);
  }
  const floors = [...flat].filter(([h, a]) => a > 2 && h < -0.01 && h > -height + 0.01).map(([h]) => h);

  return { tris, height, size, silhouette, undercuts, floors, notes, ...map };
}

// The outline of some of the triangles seen from above. Clipper gets them a few dozen at a time,
// then the pieces get joined in pairs, which is much quicker than all at once.
function shadow(tris, keep) {
  let level = [];
  let batch = [];
  for (let k = 0; k < tris.length; k += 9) {
    if (!keep(k)) continue;
    const p = toInt([[tris[k], tris[k + 1]], [tris[k + 3], tris[k + 4]], [tris[k + 6], tris[k + 7]]]);
    const a = area(p);
    if (Math.abs(a) < 1e-6) continue; // seen edge on, a wall
    batch.push(a > 0 ? p : p.reverse());
    if (batch.length === 64) { level.push(union(batch)); batch = []; }
  }
  if (batch.length) level.push(union(batch));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? union([...level[i], ...level[i + 1]]) : level[i]);
    level = next;
  }
  // crumbs thinner than 0.2 mm aren't worth cutting round
  const whole = pieces(closeGaps(level[0] || []));
  return union(whole.map(p => [p.outer, ...p.holes]).filter(p => offset(p, -0.1).length).flat());
}

// A grid of the part's height seen from above. Each cell holds the highest the part gets anywhere
// over that cell (not just at its middle), so a bit kept off the cells is kept off the part.
// Cells with nothing over them hold -Infinity.
function heightMap(tris, size) {
  const res = Math.min(0.5, Math.max(0.1, Math.sqrt((size.x + 2) * (size.y + 2) / 6e5)));
  const ox = -res, oy = -res;
  const nx = Math.ceil(size.x / res) + 3, ny = Math.ceil(size.y / res) + 3;
  const z = new Float64Array(nx * ny).fill(-Infinity);
  for (let k = 0; k < tris.length; k += 9) {
    const t = [[tris[k], tris[k + 1], tris[k + 2]], [tris[k + 3], tris[k + 4], tris[k + 5]], [tris[k + 6], tris[k + 7], tris[k + 8]]];
    const i0 = Math.max(0, Math.floor((Math.min(t[0][0], t[1][0], t[2][0]) - ox) / res));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(t[0][0], t[1][0], t[2][0]) - ox) / res));
    const j0 = Math.max(0, Math.floor((Math.min(t[0][1], t[1][1], t[2][1]) - oy) / res));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(t[0][1], t[1][1], t[2][1]) - oy) / res));
    for (let j = j0; j <= j1; j++) {
      // the strip of the triangle over this row of cells, then each cell of it
      const row = clip(clip(t, 1, oy + j * res, 1), 1, oy + (j + 1) * res, -1);
      if (!row.length) continue;
      for (let i = i0; i <= i1; i++) {
        const piece = clip(clip(row, 0, ox + i * res, 1), 0, ox + (i + 1) * res, -1);
        let h = -Infinity;
        for (const p of piece) h = Math.max(h, p[2]);
        if (h > z[j * nx + i]) z[j * nx + i] = h;
      }
    }
  }

  const cell = (i0, i1, j0, j1) => toInt([[ox + i0 * res, oy + j0 * res], [ox + i1 * res, oy + j0 * res], [ox + i1 * res, oy + j1 * res], [ox + i0 * res, oy + j1 * res]]);
  return {
    res, nx, ny, ox, oy, z,
    // Where the part is higher than `level`, seen from above: whole cells, as Clipper paths. Runs
    // of cells along a row become one rectangle, and the same run on the next rows makes it taller.
    // A flat floor right at the level doesn't count (floors are found to the nearest 0.01 mm).
    sliceAbove(level) {
      level += 0.01;
      const rects = [];
      let open = new Map();
      for (let j = 0; j <= ny; j++) {
        const runs = new Map();
        for (let i = 0; j < ny && i < nx; i++) {
          if (!(z[j * nx + i] > level)) continue;
          let e = i;
          while (e + 1 < nx && z[j * nx + e + 1] > level) e++;
          runs.set(`${i},${e}`, [i, e]);
          i = e;
        }
        for (const [key, r] of open) if (!runs.has(key)) { rects.push(cell(r.i0, r.i1 + 1, r.j0, j)); open.delete(key); }
        for (const [key, [i0, i1]] of runs) if (!open.has(key)) open.set(key, { i0, i1, j0: j });
      }
      return union(rects);
    },
    // The highest the part gets in the cells whose middles aren't inside `paths`.
    highestOutside(paths) {
      let top = -Infinity;
      for (let j = 0; j < ny; j++) {
        const xs = scanline(paths, oy + (j + 0.5) * res);
        let s = 0;
        for (let i = 0; i < nx; i++) {
          const x = ox + (i + 0.5) * res;
          while (s < xs.length && xs[s] <= x) s++;
          if (s % 2 === 0) top = Math.max(top, z[j * nx + i]);
        }
      }
      return top;
    },
  };
}

// The part of a polygon (3D points) on one side of a line x = at (axis 0) or y = at (axis 1):
// the side where (p[axis] - at) * sign >= 0. Points on the line count, so a triangle that only
// touches a cell still raises it.
function clip(poly, axis, at, sign) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = (p[axis] - at) * sign, dq = (q[axis] - at) * sign;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0) && dp !== dq) {
      const f = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f]);
    }
  }
  return out;
}

// Whether (x, y) is on the triangle starting at tris[k], seen from above, edges included.
function over(tris, k, x, y) {
  const side = (p, q) => (tris[q] - tris[p]) * (y - tris[p + 1]) - (tris[q + 1] - tris[p + 1]) * (x - tris[p]);
  const s1 = side(k, k + 3), s2 = side(k + 3, k + 6), s3 = side(k + 6, k);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

// Drops a ball-nose bit of radius R straight down onto the part at (x, y) and gives the height its
// tip stops at, or -Infinity if it misses. The ball can touch a triangle's face, one of its edges
// or one of its corners, and the highest of those wins. Triangles are kept in square buckets so
// each drop only looks at the ones near it.
export function ballDropper(solid, R) {
  const { tris } = solid;
  const n = tris.length / 9;
  const size = Math.max(R / 2, 0.5);
  const bx = Math.ceil((solid.size.x + 2 * R) / size) + 1, by = Math.ceil((solid.size.y + 2 * R) / size) + 1;
  const buckets = Array.from({ length: bx * by }, () => []);
  const at = (v, count) => Math.max(0, Math.min(count - 1, Math.floor((v + R) / size)));
  // each triangle's plane, with its normal turned to face up (a ball from above only ever meets
  // the top of a face, whichever way the face looks)
  // and its box seen from above, and its top
  const plane = new Float64Array(n * 4), box = new Float64Array(n * 5);
  for (let t = 0; t < n; t++) {
    const k = t * 9;
    const a = [tris[k], tris[k + 1], tris[k + 2]];
    let nv = cross(sub(tris.subarray(k + 3, k + 6), a), sub(tris.subarray(k + 6, k + 9), a));
    const len = Math.hypot(...nv);
    nv = len ? nv.map(v => v / len * (nv[2] < 0 ? -1 : 1)) : [0, 0, 0];
    plane.set([nv[0], nv[1], nv[2], dot(nv, a)], t * 4);
    const xs = [tris[k], tris[k + 3], tris[k + 6]], ys = [tris[k + 1], tris[k + 4], tris[k + 7]];
    box.set([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.max(tris[k + 2], tris[k + 5], tris[k + 8])], t * 5);
    for (let j = at(Math.min(...ys), by); j <= at(Math.max(...ys), by); j++) {
      for (let i = at(Math.min(...xs), bx); i <= at(Math.max(...xs), bx); i++) buckets[j * bx + i].push(t);
    }
  }
  const seen = new Int32Array(n);
  let tick = 0;
  const R2 = R * R;
  return (x, y) => {
    tick++;
    let best = -Infinity;
    for (let j = at(y - R, by); j <= at(y + R, by); j++) {
      for (let i = at(x - R, bx); i <= at(x + R, bx); i++) {
        for (const t of buckets[j * bx + i]) {
          if (seen[t] === tick) continue;
          seen[t] = tick;
          // nothing on this triangle can hold the ball up higher than its top corner does
          const b = t * 5;
          if (box[b + 4] + R <= best || box[b] > x + R || box[b + 1] < x - R || box[b + 2] > y + R || box[b + 3] < y - R) continue;
          const k = t * 9;
          const nx = plane[t * 4], ny = plane[t * 4 + 1], nz = plane[t * 4 + 2], d = plane[t * 4 + 3];
          if (nz > 1e-6) {
            // the ball's centre sits R off the plane; it touches at the point straight below that
            const cz = (d + R - nx * x - ny * y) / nz;
            if (cz > best && over(tris, k, x - R * nx, y - R * ny)) best = cz;
          }
          // a corner or an edge can only hold it up higher than its own top
          for (let c = 0; c < 3; c++) {
            const p = k + 3 * c, q = k + 3 * ((c + 1) % 3);
            if (Math.max(tris[p + 2], tris[q + 2]) + R <= best) continue;
            const dx = x - tris[p], dy = y - tris[p + 1];
            const d2 = dx * dx + dy * dy;
            if (d2 <= R2) best = Math.max(best, tris[p + 2] + Math.sqrt(R2 - d2));
            best = Math.max(best, onEdge(tris[p], tris[p + 1], tris[p + 2], tris[q], tris[q + 1], tris[q + 2], x, y, R2));
          }
        }
      }
    }
    return best - R;
  };
}

// Where the ball's centre stops on the edge from a to b: the ball's slice in the edge's upright
// plane is a circle, and that circle rests on the edge's line. -Infinity if it touches past an end.
function onEdge(ax, ay, az, bx, by, bz, x, y, R2) {
  const ex = bx - ax, ey = by - ay;
  const L = Math.hypot(ex, ey);
  if (L < 1e-9) return -Infinity; // straight up and down: its top corner counts instead
  const ux = ex / L, uy = ey / L;
  const px = x - ax, py = y - ay;
  const off = px * uy - py * ux;
  if (off * off >= R2) return -Infinity;
  const t = px * ux + py * uy;
  const m = (bz - az) / L, r = Math.sqrt(R2 - off * off), k = Math.sqrt(1 + m * m);
  const touch = t + m * r / k;
  if (touch < 0 || touch > L) return -Infinity;
  return az + m * t + r * k;
}
