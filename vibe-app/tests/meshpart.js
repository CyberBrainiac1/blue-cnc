// Helpers for testing 3D parts made as triangle meshes: the Onshape-style faces and loops the flat
// reader wants (so a test part goes through the same "flat first, then 3D" path as the page), and
// the part's top seen from above, to check cuts against.

const key = p => p.map(v => Math.round(v * 1e5)).join(',');
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Triangles ([[a, b, c], ...] in mm) as compactMesh gives them: a flat list in metres.
export function toMesh(tris) {
  const triangles = [];
  for (const t of tris) for (const p of t) triangles.push(p[0] / 1000, p[1] / 1000, p[2] / 1000);
  return { triangles };
}

// Triangles as Onshape faces (compactPart's format): triangles that lie flat against each other
// join up into one flat face, and the small facets of a curved surface join across smooth edges
// into one curved face, the way Onshape keeps a fillet or a dome as one face.
export function meshToPart(tris) {
  const ids = new Map();
  const vid = p => { const k = key(p); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const info = [];
  for (const t of tris) {
    const n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    const len = Math.hypot(...n);
    if (len < 1e-9) continue;
    const u = n.map(v => v / len);
    info.push({ t, v: t.map(vid), n: u, d: dot(u, t[0]) });
  }
  const parent = info.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a, b) => { parent[find(a)] = find(b); };
  const byEdge = new Map();
  info.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const a = f.v[k], b = f.v[(k + 1) % 3];
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!byEdge.has(e)) byEdge.set(e, []);
      byEdge.get(e).push(i);
    }
  });
  const pairs = [...byEdge.values()].filter(l => l.length === 2);
  // flat faces first
  for (const [i, j] of pairs) {
    if (dot(info[i].n, info[j].n) > 1 - 1e-7 && Math.abs(info[i].d - info[j].d) < 1e-4) join(i, j);
  }
  // then the facets of curved surfaces (groups of one or two triangles) across smooth edges, and
  // all the sloped ones that touch, the way Onshape keeps a rounded or drafted wall as one face
  const size = new Map();
  info.forEach((_, i) => size.set(find(i), (size.get(find(i)) || 0) + 1));
  const facet = i => size.get(find(i)) <= 2;
  const sloped = i => Math.abs(info[i].n[2]) > 0.02 && Math.abs(info[i].n[2]) < 0.9999;
  for (const [i, j] of pairs) {
    if (facet(i) && facet(j) && (dot(info[i].n, info[j].n) > Math.cos(35 * Math.PI / 180) || (sloped(i) && sloped(j)))) join(i, j);
  }
  for (const [i] of info.entries()) find(i);

  const groups = new Map();
  info.forEach((f, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(f); });
  const point = new Map();
  for (const t of tris) for (const p of t) point.set(vid(p), p);
  const faces = [], edges = [];
  for (const list of groups.values()) {
    // the boundary: directed edges with no partner going the other way inside the group
    const directed = new Map();
    for (const f of list) for (let k = 0; k < 3; k++) {
      const a = f.v[k], b = f.v[(k + 1) % 3];
      directed.set(`${a}|${b}`, [a, b]);
    }
    const next = new Map();
    for (const [k, [a, b]] of directed) {
      if (directed.has(`${b}|${a}`)) continue;
      if (!next.has(a)) next.set(a, []);
      next.get(a).push(b);
    }
    const loops = [];
    for (const start of [...next.keys()]) {
      while (next.get(start)?.length) {
        const loop = [start];
        let at = next.get(start).pop();
        while (at !== start && next.get(at)?.length && loop.length < 1e6) {
          loop.push(at);
          at = next.get(at).pop();
        }
        if (loop.length >= 3) loops.push(loop.map(v => point.get(v)));
      }
    }
    if (!loops.length) continue;
    const flat = list.every(f => dot(f.n, list[0].n) > 1 - 1e-7);
    // the outer loop is the longest one
    const length = l => l.reduce((s, p, i) => s + Math.hypot(...sub(p, l[(i + 1) % l.length])), 0);
    const outer = loops.indexOf(loops.reduce((a, b) => (length(b) > length(a) ? b : a)));
    const face = {
      id: `F${faces.length}`,
      type: flat ? 'PLANE' : 'BSURFACE',
      normal: flat ? list[0].n : undefined,
      origin: flat ? list[0].t[0].map(v => v / 1000) : undefined,
      orientation: true,
      loops: loops.map((l, i) => {
        const id = `E${edges.length}`;
        edges.push({ id, type: 'LINE', points: [...l, l[0]].map(p => p.map(v => v / 1000)) });
        return { isOuter: i === outer, coedges: [[id, true]] };
      }),
    };
    faces.push(face);
  }
  return { faces, edges };
}

// The part's top seen from above, from a flat list of corners in mm: the highest triangle over
// (x, y), or -Infinity off the part.
export function meshTop(tris) {
  const B = 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let k = 0; k < tris.length; k += 3) {
    minX = Math.min(minX, tris[k]); maxX = Math.max(maxX, tris[k]);
    minY = Math.min(minY, tris[k + 1]); maxY = Math.max(maxY, tris[k + 1]);
  }
  const nx = Math.ceil((maxX - minX) / B) + 1, ny = Math.ceil((maxY - minY) / B) + 1;
  const buckets = Array.from({ length: nx * ny }, () => []);
  for (let k = 0; k < tris.length; k += 9) {
    const xs = [tris[k], tris[k + 3], tris[k + 6]], ys = [tris[k + 1], tris[k + 4], tris[k + 7]];
    const det = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
    if (Math.abs(det) < 1e-12) continue;
    for (let j = Math.floor((Math.min(...ys) - minY) / B); j <= Math.floor((Math.max(...ys) - minY) / B); j++) {
      for (let i = Math.floor((Math.min(...xs) - minX) / B); i <= Math.floor((Math.max(...xs) - minX) / B); i++) buckets[j * nx + i].push(k);
    }
  }
  return (x, y) => {
    const i = Math.floor((x - minX) / B), j = Math.floor((y - minY) / B);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return -Infinity;
    let top = -Infinity;
    for (const k of buckets[j * nx + i]) {
      const ax = tris[k], ay = tris[k + 1];
      const bx = tris[k + 3] - ax, by = tris[k + 4] - ay, cx = tris[k + 6] - ax, cy = tris[k + 7] - ay;
      const det = bx * cy - cx * by;
      const s = ((x - ax) * cy - cx * (y - ay)) / det, t = (bx * (y - ay) - (x - ax) * by) / det;
      if (s < -1e-9 || t < -1e-9 || s + t > 1 + 1e-9) continue;
      top = Math.max(top, tris[k + 2] + s * (tris[k + 5] - tris[k + 2]) + t * (tris[k + 8] - tris[k + 2]));
    }
    return top;
  };
}

// The total area and signed volume of a mesh (flat list in mm), to tell it was only moved and
// turned, never stretched or mirrored.
export function measure(tris) {
  let areaSum = 0, volume = 0;
  for (let k = 0; k < tris.length; k += 9) {
    const a = [tris[k], tris[k + 1], tris[k + 2]], b = [tris[k + 3], tris[k + 4], tris[k + 5]], c = [tris[k + 6], tris[k + 7], tris[k + 8]];
    areaSum += Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
    volume += dot(a, cross(b, c)) / 6;
  }
  return { area: areaSum, volume };
}
