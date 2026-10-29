// Polygon helpers on top of Clipper (js/vendor/clipper.js). Clipper wants whole numbers,
// so everything in here is micrometres: 1 mm = 1000.

const C = () => globalThis.ClipperLib;

export const SCALE = 1000;
const ARC_TOLERANCE = 10; // 0.01 mm, how closely offset corners follow a true arc

export const toInt = pts => pts.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
export const toMm = path => path.map(p => [p.X / SCALE, p.Y / SCALE]);

export const area = path => C().Clipper.Area(path) / (SCALE * SCALE); // mm², positive when anticlockwise
export const totalArea = paths => paths.reduce((a, p) => a + area(p), 0);

function run(type, subject, clip = [], fill) {
  const c = new (C().Clipper)();
  c.AddPaths(subject, C().PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, C().PolyType.ptClip, true);
  const out = [];
  const f = fill ?? C().PolyFillType.pftNonZero;
  c.Execute(type, out, f, C().PolyFillType.pftNonZero);
  return out;
}

export const union = paths => run(C().ClipType.ctUnion, paths);
export const unionEvenOdd = paths => run(C().ClipType.ctUnion, paths, [], C().PolyFillType.pftEvenOdd);
export const difference = (a, b) => run(C().ClipType.ctDifference, a, b);
export const intersection = (a, b) => run(C().ClipType.ctIntersection, a, b);

// Grows (mm > 0) or shrinks (mm < 0) closed regions, with round corners.
// Clipper can leave tiny phantom holes when it offsets many paths at once and one of them
// collapses, so each boundary goes through on its own and the pieces get put back together.
export function offset(paths, mm) {
  if (!paths.length) return [];
  const out = [];
  for (const piece of pieces(paths)) {
    const outer = offsetOne(piece.outer, mm);
    const holes = union(piece.holes.flatMap(h => offsetOne(reversed(h), -mm)));
    out.push(...(holes.length ? difference(outer, holes) : outer));
  }
  return union(out);
}

function offsetOne(path, mm) {
  const co = new (C().ClipperOffset)(2, ARC_TOLERANCE);
  co.AddPath(path, C().JoinType.jtRound, C().EndType.etClosedPolygon);
  const out = [];
  co.Execute(out, mm * SCALE);
  return out;
}

// Splits regions into separate pieces: each outer boundary with the holes directly inside it.
export function pieces(paths) {
  const c = new (C().Clipper)();
  c.AddPaths(paths, C().PolyType.ptSubject, true);
  const tree = new (C().PolyTree)();
  c.Execute(C().ClipType.ctUnion, tree, C().PolyFillType.pftNonZero, C().PolyFillType.pftNonZero);
  const found = [];
  const walk = node => {
    for (const child of node.Childs()) {
      if (!child.IsHole()) {
        found.push({ outer: child.Contour(), holes: child.Childs().map(h => h.Contour()) });
      }
      child.Childs().forEach(walk);
    }
  };
  walk(tree);
  return found;
}

export function bounds(paths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of paths) {
    for (const p of path) {
      minX = Math.min(minX, p.X); minY = Math.min(minY, p.Y);
      maxX = Math.max(maxX, p.X); maxY = Math.max(maxY, p.Y);
    }
  }
  return { minX: minX / SCALE, minY: minY / SCALE, maxX: maxX / SCALE, maxY: maxY / SCALE };
}

export const reversed = path => [...path].reverse();

export function perimeter(path) {
  let len = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[(i + 1) % path.length];
    len += Math.hypot(b.X - a.X, b.Y - a.Y);
  }
  return len / SCALE;
}

// If a hole is close to a circle, returns its centre and radius in mm. `inside` is how far the
// nearest side is from the centre, a touch less than r because the sides are short straight chords.
export function asCircle(path) {
  const pts = toMm(path);
  if (pts.length < 8) return null;
  // the middle of the box, not the average point: tessellation bunches points up in places
  const b = bounds([path]);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const r = (b.maxX - b.minX + b.maxY - b.minY) / 4;
  const off = Math.max(...pts.map(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - r)));
  if (off > Math.max(0.02, r * 0.005)) return null;
  let inside = Infinity;
  pts.forEach((a, i) => { inside = Math.min(inside, distToSegment([cx, cy], a, pts[(i + 1) % pts.length])); });
  return { x: cx, y: cy, r, inside };
}

export function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Drops points the path doesn't need: the tidied path never strays more than 0.005 mm from the
// original. Offsets and tessellation leave lots of points, and each one is a line of G-code.
export function tidy(path, tolerance = 5) {
  const n = path.length;
  if (n < 4) return path;
  // split the loop at its first point and the point furthest from it, then simplify both halves
  const far = path.reduce((best, p, i) => (dist2(p, path[0]) > dist2(path[best], path[0]) ? i : best), 0);
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = path[i], b = path[j % n];
    let worst = -1, worstD = tolerance;
    for (let k = i + 1; k < j; k++) {
      const d = distToSegment([path[k].X, path[k].Y], [a.X, a.Y], [b.X, b.Y]);
      if (d > worstD) { worstD = d; worst = k; }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  const out = path.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : path;
}

const dist2 = (p, q) => (p.X - q.X) ** 2 + (p.Y - q.Y) ** 2;

// Where a horizontal line at `y` (mm) crosses the edges of some regions, left to right. Inside is
// between the 1st and 2nd crossing, the 3rd and 4th, and so on.
export function scanline(paths, y) {
  const xs = [];
  for (const path of paths) {
    for (let i = 0; i < path.length; i++) {
      const a = path[i], b = path[(i + 1) % path.length];
      const ay = a.Y / SCALE, by = b.Y / SCALE;
      if ((ay <= y) !== (by <= y)) xs.push((a.X + (y - ay) / (by - ay) * (b.X - a.X)) / SCALE);
    }
  }
  return xs.sort((p, q) => p - q);
}
