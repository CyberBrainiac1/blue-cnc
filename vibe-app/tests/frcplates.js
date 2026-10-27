// Three FRC-style sample plates, built in the same shape as an Onshape part (see compactPart in
// js/part.js). `node tests/frcplates.js` writes them to samples/ for the app's "Try a sample" list.

import './clipper.js';
import { writeFileSync } from 'node:fs';
import { toInt, toMm, union, difference, intersection, pieces, offset } from '../js/geom.js';

const IN = 25.4;
const circle = (cx, cy, d) => Array.from({ length: 96 }, (_, i) => [cx + d / 2 * Math.cos(Math.PI * i / 48), cy + d / 2 * Math.sin(Math.PI * i / 48)]);
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const rounded = (pts, rad) => offset(offset([toInt(pts)], -rad), rad);

// outline and holes are regions (Clipper paths), pockets are [region, depth from the top]
function plate(name, thickness, outline, holes, pockets = []) {
  const footprint = difference(outline, union(holes));
  let layers = [{ h: thickness, region: footprint }];
  for (const [shape, depth] of pockets) {
    const area = intersection(shape, footprint);
    layers = layers.map(l => ({ h: l.h, region: difference(l.region, area) }));
    layers.push({ h: thickness - depth, region: area });
  }
  const faces = [], edges = [];
  const face = (region, z, up) => {
    for (const piece of pieces(region)) {
      const loops = [piece.outer, ...piece.holes].map((path, i) => {
        const pts = toMm(path);
        const id = `E${edges.length}`;
        edges.push({ id, type: 'SPLINE', points: [...pts, pts[0]].map(([x, y]) => [x / 1000, y / 1000, z / 1000]) });
        return { isOuter: i === 0, coedges: [[id, true]] };
      });
      const [x, y] = toMm(piece.outer)[0];
      faces.push({ id: `F${faces.length}`, type: 'PLANE', normal: [0, 0, up ? 1 : -1], origin: [x / 1000, y / 1000, z / 1000], orientation: true, loops });
    }
  };
  for (const l of layers) face(l.region, l.h, true);
  face(footprint, 0, false);
  return { name, part: { faces, edges } };
}

export function samplePlates() {
  // 1/4" aluminium gusset: bolt holes for #10 screws on a 1/2" pitch, and a lightening cutout
  const gussetOutline = rounded([[0, 0], [160, 0], [160, 45], [45, 160], [0, 160]], 6);
  const bolts = [];
  for (let i = 0; i < 9; i++) bolts.push(circle(12.7 + i * 12.7 * 1.1, 12.7, 0.201 * IN), circle(12.7, 25.4 + i * 12.7 * 1.0, 0.201 * IN));
  const lightening = rounded([[35, 35], [115, 35], [35, 115]], 5);
  const gusset = plate('Gusset, 1/4 in aluminium', IN / 4, gussetOutline, [...bolts.map(toInt), ...lightening]);

  // 1/8" polycarbonate bellypan: rivet holes round the edge and two wire pass-throughs
  const panOutline = rounded(rect(0, 0, 300, 250), 10);
  const rivets = [];
  for (let x = 15; x <= 285; x += 45) rivets.push(circle(x, 10, 0.193 * IN), circle(x, 240, 0.193 * IN));
  for (let y = 55; y <= 195; y += 45) rivets.push(circle(10, y, 0.193 * IN), circle(290, y, 0.193 * IN));
  const wires = [rounded(rect(60, 100, 60, 40), 4), rounded(rect(180, 100, 60, 40), 4)].flat();
  const pan = plate('Bellypan, 1/8 in polycarbonate', IN / 8, panOutline, [...rivets.map(toInt), ...wires]);

  // 1/2" aluminium bearing plate: a 1.125" bearing bore with a counterbore for the flange,
  // four bolt holes and a shallow pocket to save weight
  const bearingOutline = rounded(rect(0, 0, 110, 70), 5);
  const bore = toInt(circle(35, 35, 1.125 * IN));
  const boltHoles = [[12, 12], [58, 12], [12, 58], [58, 58]].map(([x, y]) => toInt(circle(x, y, 0.201 * IN)));
  const bearing = plate('Bearing plate, 1/2 in aluminium', IN / 2, bearingOutline, [bore, ...boltHoles], [
    [[toInt(circle(35, 35, 1.375 * IN))], 3],
    [rounded(rect(72, 12, 28, 46), 4), 6],
  ]);
  return [gusset, pan, bearing];
}

if (process.argv[1]?.endsWith('frcplates.js')) {
  const files = [];
  for (const { name, part } of samplePlates()) {
    const file = name.split(',')[0].toLowerCase().replace(/\W+/g, '_') + '.json';
    writeFileSync(new URL(`../samples/${file}`, import.meta.url), JSON.stringify({ name, part }));
    files.push({ name, file });
  }
  writeFileSync(new URL('../samples/plates.json', import.meta.url), JSON.stringify(files, null, 1));
  console.log(files);
}
