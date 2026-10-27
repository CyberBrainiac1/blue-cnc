// Runs one random part through the reader and the CAM, and decides if the answer is acceptable:
// good G-code that passes every check, or a plain message saying why not. Anything else fails.

import './clipper.js';
import { makePart } from './fuzzparts.js';
import { readPlate, PartError } from '../js/part.js';
import { makeToolpaths, settingsFor, CamError } from '../js/cam.js';
import { TEAM_MACHINE } from '../js/convert.js';
import { checkJob } from './check.js';

export function tryPart(seed) {
  const t0 = performance.now();
  let made;
  try {
    made = makePart(seed);
  } catch (e) {
    return { seed, outcome: 'fail', problems: [`the generator broke: ${e.stack}`] };
  }
  const { part, truth, expect, material, bit, settings, tags } = made;
  const out = { seed, tags };
  let plate, job;
  try {
    plate = readPlate(JSON.parse(JSON.stringify(part)));
    job = makeToolpaths(plate, { ...settingsFor(material, bit), ...settings }, TEAM_MACHINE);
  } catch (e) {
    const clear = (e instanceof PartError || e instanceof CamError) && e.message.length > 15 && e.message.length < 400 && !/undefined|NaN|\[object/.test(e.message);
    if (!clear) return { ...out, outcome: 'fail', problems: [`crashed: ${e.stack || e}`] };
    if (expect === 'cut') return { ...out, outcome: 'fail', problems: [`a plain part was turned down: ${e.message}`] };
    return { ...out, outcome: 'rejected', message: e.message, ms: performance.now() - t0 };
  }
  const problems = expect === 'reject' ? ['should have been turned down, but made G-code'] : [];
  problems.push(...checkJob(job, plate, TEAM_MACHINE));

  // the reader got the part right
  if (expect === 'cut') {
    if (Math.abs(plate.thickness - truth.thickness) > 0.01) problems.push(`read ${plate.thickness} mm thick, really ${truth.thickness}`);
    const area = plate.footprint.reduce((a, p) => a + globalThis.ClipperLib.Clipper.Area(p), 0) / 1e6;
    if (Math.abs(area - truth.area) > truth.area * 0.01 + 2) problems.push(`read ${area.toFixed(1)} mm² of part, really ${truth.area.toFixed(1)}`);
  }
  const ms = performance.now() - t0;
  if (ms > 60000) problems.push(`took ${Math.round(ms / 1000)} s`);
  return { ...out, outcome: problems.length ? 'fail' : 'cut', problems, ms, minutes: job.minutes, lines: job.lines.length };
}
