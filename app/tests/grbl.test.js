import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GrblSender, cleanLine, parseStatus, RX_BUFFER } from '../js/grbl.js';
import { MockGrbl } from '../js/mockgrbl.js';
import { convert } from '../js/convert.js';

const sample = name => readFileSync(new URL(`./samples/${name}`, import.meta.url), 'utf8');

// Hooks a sender to a mock GRBL and resolves when the job ends one way or another.
function run(lines, mockOptions = {}, onReady) {
  return new Promise(resolve => {
    let sender;
    const events = [];
    const mock = new MockGrbl({ ...mockOptions, reply: text => sender.receive(text) });
    sender = new GrblSender(data => mock.write(data), {
      ready: () => { events.push('ready'); onReady ? onReady(sender, mock) : sender.start(lines); },
      done: () => resolve({ mock, sender, events }),
      error: (code, text, line) => { events.push(`error:${code}@${line}`); resolve({ mock, sender, events }); },
      alarm: code => { events.push(`alarm:${code}`); resolve({ mock, sender, events }); },
    });
  });
}

test('cleanLine strips comments and spaces', () => {
  assert.equal(cleanLine('G1 X10 Y5 (cut) ; note'), 'G1X10Y5');
  assert.equal(cleanLine('(only a comment)'), '');
});

test('streams a whole job without overfilling the 128 byte buffer', async () => {
  const lines = convert(sample('solidworks_mach3.txt')).lines;
  let resumes = 0;
  const { mock, sender } = await run(lines, { msPerLine: 1 }, (sender, mock) => {
    // the file pauses at its tool change (M0), so press Resume like a person would
    const timer = setInterval(() => {
      if (mock.state === 'Hold') { resumes++; sender.resume(); }
      if (!sender.running) clearInterval(timer);
    }, 10);
    sender.start(lines);
  });
  assert.equal(resumes, 1, 'it paused once, at the tool change');
  assert.equal(mock.overflowed, false);
  assert.deepEqual(mock.received, lines.map(cleanLine).filter(Boolean));
  assert.equal(sender.acked, sender.total);
});

test('keeps several lines queued in GRBL at once', async () => {
  const lines = Array.from({ length: 200 }, (_, i) => `G1 X${i} Y${i} F500`);
  let most = 0;
  let mostBytes = 0;
  const { mock } = await run(lines, { msPerLine: 2 }, sender => {
    const pump = sender.pump.bind(sender);
    sender.pump = () => {
      pump();
      most = Math.max(most, sender.inFlight.length);
      mostBytes = Math.max(mostBytes, sender.inFlight.reduce((a, b) => a + b, 0));
    };
    sender.start(lines);
  });
  assert.equal(mock.overflowed, false);
  assert.ok(most > 3, `only ${most} lines were ever in flight`);
  assert.ok(mostBytes < RX_BUFFER, `${mostBytes} bytes were in flight`);
});

test('an error holds the job and says which line', async () => {
  const lines = ['G21', 'G90', 'G1 X1 F100', 'G1 X2', 'G1 X3'];
  const { events, sender } = await run(lines, { failLine: 3 });
  assert.ok(events.includes('error:20@3'));
  assert.equal(sender.held, true);
});

test('an alarm stops the job', async () => {
  const lines = Array.from({ length: 20 }, (_, i) => `G1 X${i} F500`);
  const { events, sender } = await run(lines, { alarmAt: 5 });
  assert.ok(events.includes('alarm:1'));
  assert.equal(sender.running, false);
});

test('Stop sends feed hold then soft reset, and GRBL comes back with an alarm', async () => {
  const lines = Array.from({ length: 50 }, (_, i) => `G1 X${i} F500`);
  const writes = [];
  const result = await new Promise(resolve => {
    let sender;
    const mock = new MockGrbl({ msPerLine: 5, reply: text => sender.receive(text) });
    let started = false;
    sender = new GrblSender(data => { writes.push(data); mock.write(data); }, {
      ready: () => {
        if (started) return;
        started = true;
        sender.start(lines);
        setTimeout(() => sender.stop(), 20);
      },
      alarm: code => resolve({ code, mock }),
    });
  });
  const stopAt = writes.indexOf('!');
  assert.equal(writes[stopAt + 1], '\x18');
  assert.equal(result.code, 3);
  assert.ok(result.mock.received.length < lines.length, 'the rest of the job never ran');
});

test('status reports are read', () => {
  const s = parseStatus('<Run|MPos:1.000,2.500,-3.000|FS:600,12000>');
  assert.equal(s.state, 'Run');
  assert.deepEqual(s.MPos, { x: 1, y: 2.5, z: -3 });
  assert.equal(s.feed, 600);
  assert.equal(s.speed, 12000);
});
