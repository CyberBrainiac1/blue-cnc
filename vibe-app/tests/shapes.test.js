// Small hand-built parts for the cases the 115-part Onshape test caught (2026-10-28). Each one is
// described the way Onshape does: faces with loops of edges, in metres.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './clipper.js';
import { readPlate, PartError, KIRI_TIP } from '../js/part.js';
import { makeToolpaths, settingsFor } from '../js/cam.js';
import { TEAM_MACHINE } from '../js/convert.js';

const m = p => p.map(v => v / 1000);
const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l); };

function builder() {
  const faces = [], edges = [];
  const edge = (points, type = 'LINE') => {
    const id = `E${edges.length}`;
    edges.push({ id, type, points: points.map(m) });
    return [id, true];
  };
  // a closed loop through `pts`, one straight edge per side
  const loop = (pts, isOuter = true) => ({ isOuter, coedges: pts.map((p, i) => edge([p, pts[(i + 1) % pts.length]])) });
  const face = (type, normal, origin, loops = []) => faces.push({ id: `F${faces.length}`, type, normal, origin: m(origin), orientation: true, loops });
  const at = (pts, z) => pts.map(([x, y]) => [x, y, z]);
  // top, bottom and one wall per side of an outline (mm, anticlockwise), `T` thick
  const prism = (outline, T, wallType = 'PLANE') => {
    face('PLANE', [0, 0, 1], [...outline[0], T], [loop(at(outline, T))]);
    face('PLANE', [0, 0, -1], [...outline[0], 0], [loop(at(outline, 0))]);
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length];
      const out = norm([b[1] - a[1], a[0] - b[0], 0]);
      face(wallType, wallType === 'PLANE' ? out : undefined, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, T / 2]);
    });
  };
  return { faces, edges, edge, loop, face, at, prism, part: () => ({ faces, edges }) };
}

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const turned = (pts, deg) => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
};
const cam = (plate, bit = 'quarter') => makeToolpaths(plate, settingsFor('aluminium', bit), TEAM_MACHINE);

test('a plate drawn at an angle is turned square, so its stock is no bigger than drawn straight', () => {
  const b = builder();
  b.prism(turned(rect(0, 0, 100, 60), 30), 6);
  const plate = readPlate(b.part());
  const [long, short] = [plate.size.x, plate.size.y].sort((p, q) => q - p);
  assert.ok(Math.abs(long - 100) < 0.2 && Math.abs(short - 60) < 0.2, `size ${plate.size.x} x ${plate.size.y}`);
  assert.ok(plate.notes.some(n => n.includes('turned 30 degrees')), plate.notes.join(' | '));
});

test('a long plate at 45 degrees fits once it is squared up', () => {
  const b = builder();
  b.prism(turned(rect(0, 0, 500, 50), 45), 6);
  const job = cam(readPlate(b.part()));
  assert.ok(job.stock.x <= TEAM_MACHINE.travel.x && job.stock.y <= TEAM_MACHINE.travel.y);
});

test('a square plate is not turned', () => {
  const b = builder();
  b.prism(rect(0, 0, 100, 60), 6);
  const plate = readPlate(b.part());
  assert.ok(!plate.notes.some(n => n.includes('turned')));
});

test('a plate with curved walls of any surface type (an ellipse) is cut, not refused', () => {
  const b = builder();
  const ellipse = Array.from({ length: 48 }, (_, i) => [60 * Math.cos(2 * Math.PI * i / 48), 30 * Math.sin(2 * Math.PI * i / 48)]);
  b.prism(ellipse, 6, 'SWEEP');
  const plate = readPlate(b.part());
  assert.ok(Math.abs(plate.size.x - 120) < 0.5, `size ${plate.size.x}`);
  assert.ok(cam(plate).done.some(d => d.startsWith('outline')));
});

test('a hole into the edge of the plate is listed', () => {
  const b = builder();
  b.prism(rect(0, 0, 100, 60), 10);
  const circleAt = x => Array.from({ length: 24 }, (_, i) => [x, 30 + 2.5 * Math.cos(2 * Math.PI * i / 24), 5 + 2.5 * Math.sin(2 * Math.PI * i / 24)]);
  const ring = pts => ({ isOuter: true, coedges: [b.edge([...pts, pts[0]], 'CIRCLE')] });
  b.face('CYLINDER', [1, 0, 0], [0, 30, 5], [ring(circleAt(0)), ring(circleAt(20))]);
  const plate = readPlate(b.part());
  assert.ok(plate.notes.some(n => n.includes('go into the edge')), plate.notes.join(' | '));
});

test('pockets only on the underside: cut upside down, and it says so', () => {
  const b = builder();
  const outer = rect(0, 0, 100, 60), pocket = rect(40, 20, 20, 20);
  b.face('PLANE', [0, 0, 1], [0, 0, 6], [b.loop(b.at(outer, 6))]);
  b.face('PLANE', [0, 0, -1], [0, 0, 0], [b.loop(b.at(outer, 0)), b.loop(b.at(pocket, 0), false)]);
  b.face('PLANE', [0, 0, -1], [40, 20, 2], [b.loop(b.at(pocket, 2))]);
  const plate = readPlate(b.part());
  assert.ok(plate.notes.some(n => n.includes('cut upside down')), plate.notes.join(' | '));
  assert.ok(cam(plate).done.some(d => d.startsWith('pocket')));
});

test('a plain plate is cut from the side facing up, with no flip note', () => {
  const b = builder();
  b.prism(rect(0, 0, 100, 60), 6);
  assert.ok(!readPlate(b.part()).notes.some(n => n.includes('upside down')));
});

test('a chamfer on the bottom edges is mentioned, not silently ignored', () => {
  const b = builder();
  const T = 6, c = 1;
  b.face('PLANE', [0, 0, 1], [0, 0, T], [b.loop(b.at(rect(0, 0, 100, 60), T))]);
  b.face('PLANE', [0, 0, -1], [c, c, 0], [b.loop(b.at(rect(c, c, 100 - 2 * c, 60 - 2 * c), 0))]);
  const corners = [[0, 0], [100, 0], [100, 60], [0, 60]], inset = [[c, c], [100 - c, c], [100 - c, 60 - c], [c, 60 - c]];
  corners.forEach((p, i) => {
    const q = corners[(i + 1) % 4], pi = inset[i], qi = inset[(i + 1) % 4];
    const out = norm([q[1] - p[1], p[0] - q[0], 0]);
    b.face('PLANE', norm([out[0], out[1], -1]), [...pi, 0], [b.loop([[...pi, 0], [...qi, 0], [...q, c], [...p, c]])]);
  });
  const plate = readPlate(b.part());
  assert.ok(plate.notes.some(n => n.includes('on the top or the bottom')), plate.notes.join(' | '));
});

test('gaps in the outline narrower than the bit get a warning', () => {
  const b = builder();
  // a comb: a 100 x 20 back with teeth up to y 40, 2 mm gaps between 8 mm teeth
  const pts = [[0, 0], [100, 0], [100, 40]];
  for (let x = 100; x > 10; x -= 10) pts.push([x - 8, 40], [x - 8, 20], [x - 10, 20], [x - 10, 40]);
  pts.push([0, 40]);
  b.prism(pts, 6);
  const job = cam(readPlate(b.part()));
  assert.ok(job.warnings.some(w => w.includes('narrower than the')), job.warnings.join(' | '));
});

test('a part with no top and bottom (a cone on its base) is refused with the Kiri:Moto tip', () => {
  const b = builder();
  const base = Array.from({ length: 24 }, (_, i) => [20 * Math.cos(2 * Math.PI * i / 24), 20 * Math.sin(2 * Math.PI * i / 24)]);
  b.face('PLANE', [0, 0, -1], [20, 0, 0], [b.loop(b.at(base, 0))]);
  b.face('CONE', [0, 0, 1], [0, 0, 0], [b.loop(b.at(base, 0))]);
  assert.throws(() => readPlate(b.part()), e => e instanceof PartError && e.message.includes(KIRI_TIP));
});
