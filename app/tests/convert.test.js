import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { convert, splitByTool, ConvertError, TEAM_MACHINE } from '../js/convert.js';
import { toolpath } from '../js/toolpath.js';

const sample = name => readFileSync(new URL(`./samples/${name}`, import.meta.url), 'utf8');

// Every G and M code GRBL 1.1 accepts. Anything else in the output is a bug.
const OK_G = new Set(['0', '1', '2', '3', '4', '10', '17', '18', '19', '20', '21', '28', '28.1', '30', '30.1',
  '38.2', '38.3', '38.4', '38.5', '40', '43.1', '49', '53', '54', '55', '56', '57', '58', '59', '61', '80',
  '90', '91', '91.1', '92', '92.1', '93', '94']);
const OK_M = new Set(['0', '1', '2', '30', '3', '4', '5', '7', '8', '9', '56']);

function assertGrblSafe(lines) {
  for (const line of lines) {
    const code = line.replace(/\([^)]*\)/g, '');
    assert.ok(!code.includes(';'), `semicolon left in: ${line}`);
    for (const [, k, v] of code.matchAll(/([A-Z])([-+.\d]+)/g)) {
      if (k === 'G') assert.ok(OK_G.has(String(parseFloat(v))), `GRBL can't run G${v}: ${line}`);
      if (k === 'M') assert.ok(OK_M.has(String(parseInt(v, 10))), `GRBL can't run M${v}: ${line}`);
      assert.ok('GMXYZIJKRFSPLTN'.includes(k), `unknown word ${k}: ${line}`);
      assert.notEqual(k, 'N', `line number left in: ${line}`);
      assert.notEqual(k, 'T', `tool word left in: ${line}`);
    }
    assert.ok(!/^%|^O\d/.test(line), `program line left in: ${line}`);
  }
}

const has = (lines, text) => lines.some(l => l === text);
const said = (list, bit) => list.some(c => c.text.includes(bit));

test('SolidWorks mach_iii post', () => {
  const r = convert(sample('solidworks_mach3.txt'));
  assertGrblSafe(r.lines);
  assert.ok(!r.lines.some(l => /M7\b/.test(l)), 'M7 should be gone');
  assert.ok(has(r.lines, 'M8 Z25') || has(r.lines, 'Z25'), 'G43 line keeps its Z move');
  // the second tool pauses the job
  const pause = r.lines.indexOf('M0');
  assert.ok(pause > 0);
  assert.equal(r.lines[pause - 3], 'M5');
  assert.match(r.lines[pause - 1], /Change to tool 3 5MM DRILL/);
  // G83 at X50 pecks 2.5 mm at a time from R2 down to Z-6
  for (const z of ['-0.5', '-3', '-5.5', '-6']) assert.ok(has(r.lines, `G1 Z${z} F80`), `peck to ${z}`);
  // G82 dwell P500 is in ms, so it becomes half a second
  assert.ok(has(r.lines, 'G4 P0.5'));
  // G91 G28 Z0 becomes a lift in absolute mode, then back to G91
  const lift = r.lines.lastIndexOf('G0 Z10');
  assert.equal(r.lines[lift - 1], 'G90');
  assert.ok(has(r.lines, 'G0 X0 Y0'));
  assert.ok(said(r.changes, 'drilling cycles'));
});

test('Kiri:Moto GRBL device', () => {
  const r = convert(sample('kiri_moto_grbl.nc'));
  assertGrblSafe(r.lines);
  assert.ok(has(r.lines, 'G4 P1'), 'G4 P1000 (ms) should become one second');
  assert.ok(said(r.changes, 'milliseconds'));
  assert.ok(has(r.lines, 'M0'), 'second tool pauses the job');
  assert.ok(r.lines.some(l => l.includes('drill 3mm')), 'the pause says which tool');
  assert.ok(has(r.lines, 'M30'));
});

test('Fusion grbl post', () => {
  const r = convert(sample('fusion_grbl.nc'));
  assertGrblSafe(r.lines);
  assert.ok(has(r.lines, 'G90'));
  assert.ok(has(r.lines, 'G3 X50 Y50 R10'), 'R arcs pass straight through');
  assert.ok(!has(r.lines, 'M0'), 'only one tool, so no pause');
  assert.ok(said(r.changes, 'G28'));
});

test('Onshape CAM Studio GRBL machine', () => {
  const r = convert(sample('onshape_cam_studio_grbl.nc'));
  assertGrblSafe(r.lines);
  assert.ok(said(r.changes, 'line numbers'));
  assert.ok(has(r.lines, 'G1 X30 Y0 F1000'));
  assert.equal(r.warnings.length, 0);
  assert.deepEqual(r.bounds.max, { x: 30, y: 20, z: 10 });
});

test('cutter compensation is refused with a reason', () => {
  assert.throws(() => convert(sample('cutter_comp.nc')), err => {
    assert.ok(err instanceof ConvertError);
    assert.equal(err.lineNo, 3);
    assert.match(err.reason, /cutter compensation/);
    return true;
  });
});

test('macros, subprograms and extra axes are refused', () => {
  assert.throws(() => convert('G1 X#100'), /variables or math/);
  assert.throws(() => convert('M98 P1000'), /subprograms/);
  assert.throws(() => convert('G1 X10 A90 F100'), /A axis/);
  assert.throws(() => convert('G95 G1 X1 F0.1'), /feed per revolution/);
});

test('a job bigger than the machine gets a warning', () => {
  const r = convert(sample('too_big.nc'));
  assert.ok(r.warnings.some(w => /400 mm in X/.test(w.text)));
  const small = convert(sample('too_big.nc'), { ...TEAM_MACHINE, travel: { x: 500, y: 600, z: 80 } });
  assert.equal(small.warnings.length, 0);
});

test('inch files are sized in mm', () => {
  const r = convert('G20 G90\nG0 X0 Y0 Z0.5\nG1 X15 Y1 F20');
  assert.ok(r.warnings.some(w => /381 mm in X/.test(w.text)), '15 in is 381 mm, wider than 376');
});

test('G90.1 arc centres become relative', () => {
  const r = convert('G21 G90.1\nG0 X10 Y0 Z5\nG2 X20 Y10 I20 J0');
  assert.ok(has(r.lines, 'G2 X20 Y10 I10 J0'));
});

test('fast feeds and spindle speeds get warnings, not errors', () => {
  const r = convert('G21 G90\nM3 S30000\nG1 X10 F5000');
  assert.ok(r.warnings.some(w => /S30000/.test(w.text)));
  assert.ok(r.warnings.some(w => /5000 mm\/min/.test(w.text)));
});

test('splitting by tool gives files that run on their own', () => {
  const r = convert(sample('kiri_moto_grbl.nc'));
  const parts = splitByTool(r.lines);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].at(-1), 'M30');
  assert.ok(!parts[0].includes('M0'));
  assert.deepEqual(parts[1].slice(0, 3), ['G21', 'G90', 'M3 S10000'], 'the drill file starts the spindle before it cuts');
  parts.forEach(assertGrblSafe);
  assert.equal(splitByTool(convert(sample('fusion_grbl.nc')).lines).length, 1);
});

test('the preview follows arcs', () => {
  const r = convert(sample('fusion_grbl.nc'));
  const path = toolpath(r.lines);
  assert.ok(path.segs.length > 20, 'arcs are chopped into short pieces');
  assert.ok(Math.abs(path.bounds.max.x - 60) < 0.01);
  assert.ok(Math.abs(path.bounds.min.z + 3) < 0.01);
});
