import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './clipper.js';
import { readPlate, PartError } from '../js/part.js';
import { makeToolpaths, settingsFor, CamError } from '../js/cam.js';
import { TEAM_MACHINE } from '../js/convert.js';
import { checkJob } from './check.js';
import { tryPart } from './fuzzcheck.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./parts/${name}.json`, import.meta.url)));

// Seeds the fuzz test once failed on, and what was wrong. They have to keep passing.
const REGRESSIONS = {
  5: 'tabs took over most of a tiny outline',
  10: 'a slot narrower than the plate was thick fooled the axis picker',
  15: 'pocket rings came back closer to the wall than the bit radius',
  18: 'the whole plate was treated as one pocket',
  21: 'a curved top was read as flat',
  24: 'pocket rings came back closer to the wall than the bit radius',
  26: 'a part turned to fit was checked unturned',
  37: 'hairline spikes and slivers between faces',
  39: 'pieces closer than the bit got an outline through each other',
  55: 'tidying a path moved it 0.05 mm into the part',
  62: 'Clipper left phantom holes when offsetting many paths at once',
  181: 'the generator broke on a part with no bottom face',
  225: 'holes ate most of a small part',
  421: 'an overhang that missed the part',
  561: 'tabs on a part only a few bits across',
  228: 'measuring leftover pocket area took 48 s',
  961: 'measuring leftover pocket area took over 90 s',
  5493: 'a rim-only bite at a ring that lined up with the wall below',
  5579: 'a speck left in the middle of a pocket with no warning',
  5688: 'a speck left in the middle of a pocket with no warning',
  5772: 'two tabs plus their ramps on a small part',
  5778: 'the checker looked for cuts where the bit could never fit',
  5959: 'the checker looked for cuts where the bit could never fit',
};

test('the Z motor plate reads as a 12 mm plate with 11 holes', () => {
  const plate = readPlate(fixture('z_motor_plate'));
  assert.ok(Math.abs(plate.thickness - 12) < 0.01);
  const job = makeToolpaths(plate, settingsFor('aluminium', 'eighth'), TEAM_MACHINE);
  assert.equal(job.done.filter(d => / hole$/.test(d)).length, 11);
  assert.ok(job.done.some(d => d.startsWith('pocket 3 mm deep')));
  assert.deepEqual(checkJob(job, plate, TEAM_MACHINE), []);
});

test('the Z motor plate passes every check with a 1/4" bit in wood too', () => {
  const plate = readPlate(fixture('z_motor_plate'));
  const job = makeToolpaths(plate, settingsFor('wood', 'quarter'), TEAM_MACHINE);
  assert.deepEqual(checkJob(job, plate, TEAM_MACHINE), []);
});

test('parts that are not flat plates get a plain reason', () => {
  assert.throws(() => readPlate(fixture('gantry_side_plate')), e => e instanceof PartError && /curved or sloped/.test(e.message));
  assert.throws(() => readPlate(fixture('platte')), e => e instanceof PartError && /overhang/.test(e.message));
  assert.throws(() => readPlate(fixture('bearing_block')), e => e instanceof PartError && /no flat faces/.test(e.message));
  const tall = readPlate(fixture('back_end_plate'));
  assert.throws(() => makeToolpaths(tall, settingsFor('aluminium', 'eighth'), TEAM_MACHINE), e => e instanceof CamError && /Z travel/.test(e.message));
});

test('silly settings are refused, fast ones are pulled back to the machine limits', () => {
  const plate = readPlate(fixture('z_motor_plate'));
  assert.throws(() => makeToolpaths(plate, { ...settingsFor('wood', 'quarter'), doc: 0 }, TEAM_MACHINE), CamError);
  const job = makeToolpaths(plate, { ...settingsFor('wood', 'quarter'), feed: 5000, rpm: 40000 }, TEAM_MACHINE);
  assert.ok(job.warnings.some(w => /feed was lowered/.test(w)));
  assert.ok(job.warnings.some(w => /spindle speed was lowered/.test(w)));
  assert.deepEqual(checkJob(job, plate, TEAM_MACHINE), []);
});

test('the checker catches planted mistakes', () => {
  const plate = readPlate(fixture('z_motor_plate'));
  const job = makeToolpaths(plate, settingsFor('wood', 'quarter'), TEAM_MACHINE);
  const at = job.lines.findIndex(l => l === '(outline)');
  const planted = extra => checkJob({ ...job, lines: [...job.lines.slice(0, at), ...extra, ...job.lines.slice(at)] }, plate, TEAM_MACHINE).join('\n');
  // a straight plunge into the top in the middle of the plate
  assert.match(planted(['G0 X60 Y60', 'G0 Z1', 'G1 Z-2 F300', 'G0 Z10']), /straight down/);
  // a cut across the top of the plate
  assert.match(planted(['G0 X30 Y80', 'G0 Z1', 'G1 Z0.2 F300', 'G1 X30.5 Z-1 F300', 'G1 X90', 'G0 Z10']), /gouge/);
  // a rapid across the stock below safe Z
  assert.match(planted(['G0 Z2', 'G0 X50 Y50', 'G0 Z10']), /rapid sideways/);
  // a code GRBL doesn't have, and a feed the machine can't do
  assert.match(planted(['M7']), /isn't on the GRBL list/);
  assert.match(planted(['G1 X5 F3000']), /over the machine's top speed/);
  // going below the stock bottom
  assert.match(planted(['G0 X2 Y2', 'G0 Z1', 'G1 Z-20 F300', 'G0 Z10']), /below the stock bottom/);
});

for (const [seed, what] of Object.entries(REGRESSIONS)) {
  test(`fuzz seed ${seed}: ${what}`, () => {
    const r = tryPart(+seed);
    assert.notEqual(r.outcome, 'fail', (r.problems || []).join('\n'));
  });
}

test('a handful of fresh random parts', () => {
  const start = Math.floor(Math.random() * 1e6);
  for (let seed = start; seed < start + 8; seed++) {
    const r = tryPart(seed);
    assert.notEqual(r.outcome, 'fail', `seed ${seed}: ${(r.problems || []).join('\n')}`);
  }
});
