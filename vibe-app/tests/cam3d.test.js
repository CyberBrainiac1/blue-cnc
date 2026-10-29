// 3D parts built as triangle meshes (tests/meshes.js), cut, and checked against their exact
// surfaces by reading the G-code back (tests/check3d.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './clipper.js';
import * as shapes from './meshes.js';
import { readSolid, compactMesh, ballDropper } from '../js/mesh.js';
import { make3dToolpaths } from '../js/cam3d.js';
import { settingsFor, CamError } from '../js/cam.js';
import { TEAM_MACHINE, splitByTool, convert } from '../js/convert.js';
import { check3d } from './check3d.js';
import { cutPart } from '../js/cutpart.js';
import { meshToPart, toMesh } from './meshpart.js';
import { block, axis, parts } from './curved100.js';
import { tryCurved } from './curvedone.js';

const M = TEAM_MACHINE;
const tallest = M.travel.z - M.safeZ - 0.5;
const cut = (shape, material = 'wood', rough = 'quarter', finish = 'quarterBall') =>
  make3dToolpaths(readSolid(shape.mesh, tallest), settingsFor(material, rough), settingsFor(material, finish), M);

// Every check passes, and the finish leaves the surface within a whisker of the scallops: on the
// gentle parts away from walls nowhere has more than 0.1 mm left (a skipped spot would have the
// whole allowance, 0.3 mm or more). The ball never takes more than the allowance plus a bit in one go.
function allGood(shape, job) {
  const r = check3d(job, shape, M);
  assert.deepEqual(r.problems, []);
  assert.ok(r.left.median <= r.left.scallop + 0.03, `median left ${r.left.median}`);
  assert.ok(r.left.gentle.count > 500 && r.left.gentle.max <= 0.1, `left on gentle parts: ${JSON.stringify(r.left.gentle)}`);
  assert.ok(r.biggestBite.bite <= job.allowance + 0.3, `the ball took ${r.biggestBite.bite} mm in one go`);
  return r;
}

test('a dome: roughing, a stop to change bits, then a ball-nose finish, all clean', () => {
  const shape = shapes.dome();
  const job = cut(shape);
  assert.deepEqual(job.done.map(d => d.split(/[ ,]/)[0]), ['roughing', 'outline', 'finish']);
  assert.deepEqual(job.skipped, []);
  allGood(shape, job);
});

test('the ball rides on the surface: its tip is a ball radius off the dome, not on it', () => {
  const R = 25, rb = 3.175;
  const shape = shapes.dome(R);
  const job = cut(shape);
  const stop = job.lines.indexOf('M0');
  // Rows done again sit higher on their first goes, so: never below, and most of them on it.
  let checked = 0, worst = 0, on = 0;
  const at = {};
  for (const line of job.lines.slice(stop)) {
    for (const [, k, v] of line.matchAll(/([XYZ])(-?[\d.]+)/g)) at[k] = +v;
    if (!line.startsWith('G1') || !('X' in at && 'Y' in at)) continue;
    const { X: x, Y: y, Z: z } = at;
    // from the dome's middle; on a sphere the ball's centre stays R + rb from the sphere's centre
    const r = Math.hypot(x - job.margin - R, y - job.margin - R);
    if (r > 0.8 * R) continue;
    const expect = Math.sqrt((R + rb) ** 2 - r * r) - rb - R;
    worst = Math.max(worst, expect - z);
    if (Math.abs(z - expect) < 0.02) on++;
    checked++;
  }
  assert.ok(checked > 200, `only ${checked} points checked`);
  assert.ok(worst < 0.02, `the tip goes ${worst} mm below where it should be`);
  assert.ok(on > 0.5 * checked, `only ${on} of ${checked} points are on the surface`);
});

test('the ball drop matches the exact answer on a flat, a ridge and a corner', () => {
  // a box 20 x 20 x 10: the ball sits on the top face, rests on an edge, or on a corner
  const t = shapes.extrude([[0, 0], [20, 0], [20, 10], [0, 10]], 20);
  const solid = readSolid({ triangles: t.flat(2).map(v => v / 1000) });
  const drop = ballDropper(solid, 2);
  assert.ok(Math.abs(drop(10, 10)) < 1e-9, 'on the top face');
  assert.ok(Math.abs(drop(21, 10) - (Math.sqrt(4 - 1) - 2)) < 1e-9, 'resting on the edge');
  assert.ok(Math.abs(drop(21, 21) - (Math.sqrt(4 - 2) - 2)) < 1e-9, 'resting on the corner');
  assert.equal(drop(23, 10), -Infinity, 'off the part');
});

test('a cone in aluminium, with gentle feeds', () => {
  const shape = shapes.cone(12, 15);
  const job = cut(shape, 'aluminium');
  allGood(shape, job);
  assert.ok(job.lines.every(l => !/F(\d+)/.test(l) || +l.match(/F(\d+)/)[1] <= 700), 'aluminium feeds stay gentle');
});

test('a sloped wedge, and a block with a rounded edge, with the 1/8" ball', () => {
  for (const [shape, material] of [[shapes.wedge(), 'polycarbonate'], [shapes.fillet(), 'wood']]) {
    allGood(shape, cut(shape, material, 'quarter', 'eighthBall'));
  }
});

test('a groove narrower than the roughing bit: the ball takes it down a layer at a time', () => {
  for (const along of [true, false]) {
    const shape = shapes.groove(along);
    const solid = readSolid(shape.mesh, tallest);
    assert.deepEqual(solid.notes, [], 'a slot in a block is no reason to turn it on its side');
    const job = make3dToolpaths(solid, settingsFor('aluminium', 'quarter'), settingsFor('aluminium', 'eighthBall'), M);
    assert.ok(job.warnings.some(w => w.includes('too narrow for the roughing bit')), job.warnings.join(' | '));
    if (along) assert.match(job.done.at(-1), /again where there was too much left/);
    allGood(shape, job);
  }
});

test('the tool change stops safely, says which bit, and splits into two files that run alone', () => {
  const job = cut(shapes.cone(10, 8));
  const stop = job.lines.indexOf('M0');
  assert.deepEqual(job.lines.slice(stop - 3, stop + 4), [
    'G0 Z10', 'M5', '(Change to tool 2 1/4" ball nose, re-zero Z only on the uncut stock near X0 Y0, then resume)', 'M0', 'G0 Z10', 'M3 S16000', 'G4 P3',
  ]);
  const files = splitByTool(job.lines);
  assert.equal(files.length, 2);
  assert.deepEqual(files[0].slice(-2), ['M5', 'M30']);
  for (const file of files) {
    const back = convert(file.join('\n'), M);
    assert.deepEqual([...back.changes, ...back.warnings], [], 'nothing for the converter to change');
  }
  // the second file says where X and Y are before it cuts, and gives its first cut a feed
  const firstCut = files[1].findIndex(l => l.startsWith('G1'));
  assert.ok(files[1].slice(0, firstCut).some(l => /^G0 X[\d.]+ Y[\d.]+/.test(l)));
  assert.match(files[1][firstCut], /F\d+$/);
});

test('a mushroom gets turned upside down, where nothing is hidden', () => {
  const shape = shapes.mushroom();
  const job = cut(shape);
  assert.ok(job.warnings.some(w => w.includes('upside down')), job.warnings.join(' | '));
  assert.deepEqual(job.skipped, []);
  allGood(shape, job);
});

test('a ball: the hidden bottom half is listed as an undercut, the top half is cut clean', () => {
  const shape = shapes.ball(12);
  const job = cut(shape);
  assert.equal(job.skipped.length, 1);
  assert.match(job.skipped[0].what, /^undercut near X0 to 24, Y0 to 24 mm$/);
  allGood(shape, job);
});

test('a part too tall for the Z travel any way up is refused', () => {
  assert.throws(() => cut(shapes.ball(35)), e => e instanceof CamError && /Z travel/.test(e.message));
});

test('roughing needs a flat end mill and the finish a ball nose', () => {
  const solid = readSolid(shapes.cone(10, 8).mesh);
  assert.throws(() => make3dToolpaths(solid, settingsFor('wood', 'quarterBall'), settingsFor('wood', 'quarterBall'), M), CamError);
  assert.throws(() => make3dToolpaths(solid, settingsFor('wood', 'quarter'), settingsFor('wood', 'eighth'), M), CamError);
});

test("Onshape's facet reply is read, with each triangle wound to match its normal", () => {
  const v = (x, y, z) => ({ x, y, z });
  const reply = [{
    id: 'JHD',
    faces: [{ id: 'F1', facets: [{ normal: v(0, 0, 1), vertices: [v(0, 0, 0), v(0, 0.01, 0), v(0.01, 0, 0)] }] }],
  }];
  const t = compactMesh(reply).triangles;
  assert.deepEqual(t, [0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 'turned round to face up');
  const indexed = { bodies: [{ facetPoints: [v(0, 0, 0), v(0.01, 0, 0), v(0, 0.01, 0)], faces: [{ facets: [{ indices: [0, 1, 2] }] }] }] };
  assert.deepEqual(compactMesh(indexed).triangles, [0, 0, 0, 0.01, 0, 0, 0, 0.01, 0]);
});

test('the 3D checker catches mistakes planted in good G-code', () => {
  const shape = shapes.cone(10, 8);
  const job = cut(shape);
  const stop = job.lines.indexOf('M0');
  // the last pass over a row is the one that rides on the part
  const finishLine = job.lines.findLastIndex(l => /^G1 X.* Z-[1-5]\./.test(l));
  const roughLine = job.lines.findIndex(l => /^G1 .*Z-1\.5/.test(l));
  const planted = {
    'gouge': lines => lines.map((l, i) => (i === finishLine ? l.replace(/Z(-?[\d.]+)/, (_, z) => `Z${(+z - 0.5).toFixed(3)}`) : l)),
    'straight down': lines => [...lines.slice(0, roughLine + 1), 'G1 Z-3', ...lines.slice(roughLine + 1)],
    'pauses': lines => lines.filter(l => l !== 'M0'),
    'top speed': lines => lines.map((l, i) => (i === roughLine ? `${l} F2000` : l)),
  };
  for (const [want, plant] of Object.entries(planted)) {
    const problems = check3d({ ...job, lines: plant(job.lines) }, shape, M).problems;
    assert.ok(problems.some(p => p.includes(want) || (want === 'straight down' && p.includes('steep entry'))), `${want}: ${problems.join(' | ')}`);
  }
});

test('a domed block that reads as a plate too thick to cut flat gets a 3D cut instead', () => {
  const page = tris => ({ part: meshToPart(tris), mesh: toMesh(tris), settings: settingsFor('wood', 'quarter'), finish: settingsFor('wood', 'quarterBall'), machine: M });
  // no flat top, so the flat reader takes the sides for its top and bottom: a plate 60 thick
  const domed = block(axis(60, 2), axis(60, 2), (x, y) => 20 + 10 * (1 - ((x - 30) ** 2 + (y - 30) ** 2) / 1800));
  const { kind, job } = cutPart(page(domed));
  assert.equal(kind, '3d');
  assert.match(job.warnings[0], /doesn't fit on the machine as a flat plate/);
  assert.deepEqual(job.skipped, []);
  // a plain plate too big for the machine still hears it as a plate
  assert.throws(() => cutPart(page(block(axis(400, 50), axis(600, 50), () => 6))), e => e instanceof CamError && /stock/.test(e.message));
});

test('curved test parts that once went wrong pass every check, the way the page cuts them', () => {
  const all = parts();
  // a later layer ramped in over a spot the one above couldn't reach; a floor read as above
  // itself left a band the outline came down into; a tiny outline's tab step
  for (const name of ['egg crate, 8 mm', '"UP" label', 'micro part']) {
    const r = tryCurved(all.findIndex(p => p.name.startsWith(name)), 'wood eighthBall');
    for (const run of r.runs) assert.deepEqual(run.problems, [], `${r.name}, ${run.outcome}${run.ticked ? ' (3D ticked)' : ''}`);
  }
  // a gently curved surface has facets that are nearly flat, not flat floors to stop above
  const long = all.find(p => p.name.startsWith('long part'));
  assert.deepEqual(readSolid(toMesh(long.tris), tallest).floors, []);
});
