// Reads GRBL G-code into straight segments (in mm) for the preview. Arcs get chopped into short lines.

const WORD = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;

export function toolpath(lines) {
  const segs = [];
  let pos = { x: 0, y: 0, z: 0 };
  let motion = 0;
  let absolute = true;
  let scale = 1;
  let plane = 17;

  for (const raw of lines) {
    const code = raw.replace(/\([^)]*\)/g, '').replace(/;.*/, '').toUpperCase();
    const v = {};
    const g = [];
    for (const [, k, num] of code.matchAll(WORD)) {
      if (k === 'G') g.push(parseFloat(num));
      else v[k] = parseFloat(num);
    }
    if (g.includes(20)) scale = 25.4;
    if (g.includes(21)) scale = 1;
    if (g.includes(90)) absolute = true;
    if (g.includes(91)) absolute = false;
    for (const p of [17, 18, 19]) if (g.includes(p)) plane = p;
    for (const mo of [0, 1, 2, 3]) if (g.includes(mo)) motion = mo;
    // these lines don't move the tool along the job, or move it in machine coordinates
    if (g.some(x => [4, 10, 28, 30, 53, 92].includes(x))) continue;
    if (!('X' in v || 'Y' in v || 'Z' in v)) continue;

    const to = { ...pos };
    for (const a of ['x', 'y', 'z']) {
      const k = a.toUpperCase();
      if (k in v) to[a] = absolute ? v[k] * scale : pos[a] + v[k] * scale;
    }
    if ((motion === 2 || motion === 3) && plane === 17) {
      arc(segs, pos, to, v, scale, motion === 2);
    } else {
      segs.push({ from: pos, to, rapid: motion === 0 });
    }
    pos = to;
  }
  return { segs, bounds: boundsOf(segs) };
}

function arc(segs, from, to, v, scale, clockwise) {
  let cx, cy;
  if ('R' in v) {
    // R arcs: find the centre from the radius. A negative R means the long way round.
    const r = v.R * scale;
    const dx = to.x - from.x, dy = to.y - from.y;
    const d = Math.hypot(dx, dy);
    const h = Math.sqrt(Math.max(r * r - (d / 2) ** 2, 0));
    const sign = (clockwise ? -1 : 1) * (r < 0 ? -1 : 1);
    cx = from.x + dx / 2 - sign * h * dy / d;
    cy = from.y + dy / 2 + sign * h * dx / d;
  } else {
    cx = from.x + (v.I ?? 0) * scale;
    cy = from.y + (v.J ?? 0) * scale;
  }
  const r = Math.hypot(from.x - cx, from.y - cy);
  let a0 = Math.atan2(from.y - cy, from.x - cx);
  let a1 = Math.atan2(to.y - cy, to.x - cx);
  let sweep = a1 - a0;
  if (clockwise && sweep >= 0) sweep -= 2 * Math.PI;
  if (!clockwise && sweep <= 0) sweep += 2 * Math.PI;
  const steps = Math.max(8, Math.ceil(Math.abs(sweep) * r / 0.5));
  let prev = from;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + sweep * t;
    const p = i === steps ? to : { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), z: from.z + (to.z - from.z) * t };
    segs.push({ from: prev, to: p, rapid: false });
    prev = p;
  }
}

function boundsOf(segs) {
  if (!segs.length) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const s of segs) {
    for (const p of [s.from, s.to]) {
      for (const a of ['x', 'y', 'z']) {
        min[a] = Math.min(min[a], p[a]);
        max[a] = Math.max(max[a], p[a]);
      }
    }
  }
  return { min, max };
}
