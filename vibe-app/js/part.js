// Turns an Onshape part (faces, loops and tessellated edges) into a flat plate the CAM can cut:
// its thickness, and every face that looks up, flattened onto the plate's top.
// Anything that can't be cut from the top in one go comes back as a plain reason instead.

import { toInt, unionEvenOdd, union, intersection, offset, area, totalArea, bounds, pieces } from './geom.js';

export const KIRI_TIP = 'For this part, try Kiri:Moto (free in the Onshape App Store), which can do 3D toolpaths.';

export class PartError extends Error {}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
const parallel = (a, b) => Math.abs(Math.abs(dot(a, b)) - 1) < 1e-4;
const square = (a, b) => Math.abs(dot(a, b)) < 1e-4;

// The faces and edges we need, pulled out of Onshape's bodydetails and tessellatededges replies.
export function compactPart(bodyDetails, tessellatedEdges) {
  const body = bodyDetails?.bodies?.[0];
  if (!body?.faces) throw new PartError('Onshape sent back no solid body for that part.');
  const vec = p => p && [p.x, p.y, p.z];
  const points = {};
  for (const b of tessellatedEdges.bodies || []) {
    for (const e of b.edges) points[e.id] = e.vertices.map(vec);
  }
  return {
    faces: body.faces.map(f => ({
      id: f.id,
      type: f.surface.type,
      normal: vec(f.surface.normal || f.surface.axis),
      origin: vec(f.surface.origin),
      orientation: f.orientation,
      loops: f.loops.map(l => ({ isOuter: l.isOuter, coedges: l.coedges.map(c => [c.edgeId, c.orientation]) })),
    })),
    edges: body.edges.map(e => ({ id: e.id, type: e.curve?.type, points: points[e.id] })),
  };
}

export function readPlate(part) {
  if (!part?.faces?.length) throw new PartError('That part has no faces to cut.');
  const planes = part.faces.filter(f => f.type === 'PLANE' && f.normal && f.origin);
  if (!planes.length) throw new PartError(`That part has no flat faces, so it isn't a plate. ${KIRI_TIP}`);

  const edges = new Map((part.edges || []).map(e => [e.id, (e.points || []).map(p => p.map(v => v * 1000))])); // m to mm
  const { axis, odd } = pickAxis(part.faces, planes, edges);
  const outward = f => f.orientation === false ? f.normal.map(v => -v) : f.normal;
  const heightOf = (f, up) => dot(f.origin.map(v => v * 1000), up);

  // Look from whichever side has the pockets. A plain plate looks the same from both.
  const sides = [axis, axis.map(v => -v)].map(up => {
    const ups = planes.filter(f => parallel(f.normal, up) && dot(outward(f), up) > 0);
    const downs = planes.filter(f => parallel(f.normal, up) && dot(outward(f), up) < 0);
    const top = Math.max(...ups.map(f => heightOf(f, up)));
    const bottom = Math.min(...downs.map(f => heightOf(f, up)));
    const floors = ups.filter(f => heightOf(f, up) < top - 0.001).length;
    return { up, ups, downs, top, bottom, floors };
  });
  const side = sides[1].floors > sides[0].floors ? sides[1] : sides[0];
  const other = side === sides[0] ? sides[1] : sides[0];
  const notes = [];
  if (other.floors > 0) {
    notes.push('Some pockets are on the other side of the plate and are skipped. Cut them in a second setup with the plate flipped.');
  }
  if (!isFinite(side.top) || !isFinite(side.bottom) || side.top - side.bottom < 0.05) {
    throw new PartError('Couldn\'t find a top and a bottom face on that part.');
  }

  // a right-handed frame on the top, so the part is never cut mirrored
  const up = side.up;
  const helper = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(helper.map((v, i) => v - dot(helper, up) * up[i]));
  const v = cross(up, u);
  const flat = p => [dot(p, u), dot(p, v)];

  const regionOf = f => {
    const loops = (f.loops || []).map(loop => loopPoints(loop, edges).map(flat)).filter(l => l.length >= 3);
    const region = unionEvenOdd(loops.map(toInt));
    return totalArea(region) < 1e-4 ? [] : region;
  };

  const faces = [];
  for (const f of side.ups) {
    const region = regionOf(f);
    if (region.length) faces.push({ h: heightOf(f, up) - side.top, region });
  }
  if (!faces.length) throw new PartError(`Couldn't find a flat top on that part. ${KIRI_TIP}`);
  const topArea = totalArea(union(faces.flatMap(f => f.region)));

  // Sloped and curved faces (chamfers, rounded edges) can't be cut with a flat end mill. Treat each
  // one as solid up to its highest point, so the cut leaves it square instead of cutting into it.
  const slopes = [];
  for (const f of odd) {
    const heights = (f.loops || []).flatMap(loop => loopPoints(loop, edges)).map(p => dot(p, up) - side.top);
    const region = regionOf(f);
    if (region.length && heights.length) slopes.push({ f, h: Math.min(0, Math.max(...heights)), region });
  }
  // Highest first. A face hidden under higher ones can't be seen from the top and doesn't matter.
  // If it's a sideways cylinder, it's a hole into the edge.
  slopes.sort((a, b) => b.h - a.h);
  let oddArea = 0, sideHoles = 0, sloped = 0;
  for (const { f, h, region } of slopes) {
    const above = closeGaps(union(faces.filter(g => g.h > h + 0.001).flatMap(g => g.region)));
    if (totalArea(intersection(region, above)) > totalArea(region) * 0.9) {
      if (f.type === 'CYLINDER' && square(f.normal, up)) sideHoles++;
      continue;
    }
    oddArea += totalArea(region);
    sloped++;
    faces.push({ h, region, odd: true });
  }
  if (sideHoles) {
    notes.push('Some holes go into the edge of the plate. GRBL Prep can only cut from the top, so drill and tap those by hand.');
  }
  if (oddArea > topArea * 0.3) {
    throw new PartError(`That part is mostly curved or sloped faces, so it isn't a flat plate. ${KIRI_TIP}`);
  }
  if (sloped) {
    notes.push('Chamfers, rounded edges and other sloped faces are left square. File or sand them by hand.');
  }
  // the bottom can stick out past the top (a chamfered or tapered edge), so the outline uses both
  const outlineFaces = side.downs.map(regionOf).filter(r => r.length);

  // Flat faces looking up must not sit on top of each other, or the part has an overhang
  const flats = faces.filter(f => !f.odd);
  for (let i = 0; i < flats.length; i++) {
    for (let j = i + 1; j < flats.length; j++) {
      if (Math.abs(flats[i].h - flats[j].h) < 0.001) continue;
      if (totalArea(intersection(flats[i].region, flats[j].region)) > 0.5) {
        throw new PartError(`That part has an overhang, so some of it can't be reached from the top. ${KIRI_TIP}`);
      }
    }
  }

  // shift so the front left corner of the part is X0 Y0 and its top is Z0
  // crumbs thinner than 0.2 mm, left where features nearly overlap, aren't worth an outline
  const whole = pieces(closeGaps(union([...faces.flatMap(f => f.region), ...outlineFaces.flat()])));
  const footprint = union(whole.map(p => [p.outer, ...p.holes]).filter(p => offset(p, -0.1).length).flat());
  if (!footprint.length) throw new PartError('That part has no area to cut.');
  const box = bounds(footprint);
  const dx = Math.round(box.minX * 1000), dy = Math.round(box.minY * 1000);
  const shift = paths => paths.map(path => path.map(p => ({ X: p.X - dx, Y: p.Y - dy })));
  for (const f of faces) f.region = shift(f.region);

  return {
    thickness: side.top - side.bottom,
    faces,
    footprint: shift(footprint),
    size: { x: box.maxX - box.minX, y: box.maxY - box.minY },
    notes,
  };
}

// The plate's thickness direction is the one with the most flat face area across it: the top and
// the bottom. (Not the thinnest: a slot narrower than the plate is thick has two close walls too.)
// Faces that are flat across it, straight walls along it, and holes along it are what the CAM cuts.
// Anything else (chamfers, fillets, sideways holes) comes back as "odd" to be left square or skipped.
function pickAxis(faces, planes, edges) {
  const candidates = [];
  for (const f of planes) {
    if (!candidates.some(c => parallel(c, f.normal))) candidates.push(norm(f.normal));
  }
  // a plate needs faces looking both ways along its axis, a top and a bottom
  const flatArea = a => {
    const along = planes.filter(f => parallel(f.normal, a));
    const facing = along.map(f => Math.sign(dot(f.orientation === false ? f.normal.map(v => -v) : f.normal, a)));
    const hs = along.map(f => dot(f.origin, a));
    if (!facing.includes(1) || !facing.includes(-1) || Math.max(...hs) - Math.min(...hs) < 1e-5) return 0;
    return along.reduce((sum, f) => sum + faceArea(f, edges), 0);
  };
  const scores = candidates.map(flatArea);
  const best = Math.max(...scores);
  if (!(best > 0)) throw new PartError('Couldn\'t find a top and a bottom face on that part.');
  const axis = candidates[scores.indexOf(best)];

  const fits = f => {
    if (f.type === 'PLANE') return parallel(f.normal, axis) || square(f.normal, axis);
    if (f.type === 'CYLINDER') return parallel(f.normal, axis);
    return false;
  };
  const odd = faces.filter(f => !f.normal || !fits(f));
  const curved = odd.filter(f => f.type !== 'PLANE' && f.type !== 'CYLINDER');
  if (curved.length > faces.length * 0.3) {
    throw new PartError(`That part is mostly curved faces, so it isn't a flat plate. ${KIRI_TIP}`);
  }
  return { axis, odd };
}

// Area of a flat face in mm², from its loops (Newell's method, so it works at any angle).
function faceArea(f, edges) {
  let total = 0;
  for (const loop of f.loops || []) {
    const pts = loopPoints(loop, edges);
    const sum = [0, 0, 0];
    pts.forEach((a, i) => {
      const c = cross(a, pts[(i + 1) % pts.length]);
      for (let k = 0; k < 3; k++) sum[k] += c[k];
    });
    total += (loop.isOuter ? 0.5 : -0.5) * Math.hypot(...sum);
  }
  return Math.max(total, 1e-9); // a face with no loops still counts, just barely
}

// Neighbouring faces don't meet exactly once their edges are turned into points, which leaves
// hair-thin gaps between them and hair-thin spikes sticking out. Nothing that thin matters to a
// bit, so close the gaps up and trim the spikes off.
export function closeGaps(paths) {
  return offset(offset(offset(paths, 0.05), -0.1), 0.05).filter(p => Math.abs(area(p)) > 0.01);
}

// Chains a loop's edges end to end. Each edge gets flipped if its far end is the one that meets
// the chain, which works whatever way round Onshape stored it.
function loopPoints(loop, edges) {
  const pts = [];
  const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const list = loop.coedges.map(([id]) => edges.get(id) || []).filter(e => e.length);
  if (list.length > 1) {
    // start the first edge pointing at the second one
    const [a, b] = list;
    const ends = q => [q[0], q[q.length - 1]];
    if (Math.min(...ends(b).map(p => gap(a[0], p))) < Math.min(...ends(b).map(p => gap(a[a.length - 1], p)))) list[0] = [...a].reverse();
  }
  for (const e of list) {
    const last = pts[pts.length - 1];
    const seq = last && gap(e[e.length - 1], last) < gap(e[0], last) ? [...e].reverse() : e;
    for (const p of seq) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 1e-6) pts.push(p);
    }
  }
  return pts;
}
