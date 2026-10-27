// The fuzz test: makes random parts, runs them through the reader and the CAM, and checks every
// result. Run it with `node tests/fuzz.js 500` (count) or `node tests/fuzz.js seed 1234` (one part).
// Each part gets its own worker thread, so a hang gets caught instead of stopping the run.

import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const TIME_LIMIT = 90_000; // ms for one part, reading, CAM and checks together

export function runSeeds(seeds, threads = Math.max(1, availableParallelism() - 1), onResult = () => {}) {
  return new Promise(resolve => {
    const results = [];
    let next = 0, busy = 0;
    const start = () => {
      while (busy < threads && next < seeds.length) {
        const seed = seeds[next++];
        busy++;
        const w = new Worker(fileURLToPath(new URL('./fuzzone.js', import.meta.url)), { workerData: seed });
        const timer = setTimeout(() => {
          w.terminate();
          finish({ seed, outcome: 'fail', problems: [`hung for over ${TIME_LIMIT / 1000} s`] });
        }, TIME_LIMIT);
        let done = false;
        const finish = r => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          results.push(r);
          onResult(r);
          busy--;
          if (results.length === seeds.length) resolve(results);
          else start();
        };
        w.on('message', finish);
        w.on('error', e => finish({ seed, outcome: 'fail', problems: [`worker crashed: ${e.stack || e}`] }));
        w.on('exit', () => finish({ seed, outcome: 'fail', problems: ['worker quit without an answer'] }));
      }
    };
    start();
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const seeds = args[0] === 'seed' ? args.slice(1).map(Number) : Array.from({ length: +(args[0] || 500) }, (_, i) => +(args[1] || 1) + i);
  const t0 = Date.now();
  const results = await runSeeds(seeds, undefined, r => {
    if (r.outcome === 'fail') console.log(`seed ${r.seed} FAIL [${(r.tags || []).join(', ')}]\n  ${r.problems.join('\n  ')}`);
  });
  const count = k => results.filter(r => r.outcome === k).length;
  console.log(`\n${results.length} parts in ${Math.round((Date.now() - t0) / 1000)} s: ${count('cut')} cut and checked, ${count('rejected')} clear rejections, ${count('fail')} failures`);
  const why = {};
  const gist = m => m.split('. ')[0].replace(/\d+(\.\d+)?/g, 'N');
  for (const r of results) if (r.outcome === 'rejected') why[gist(r.message)] = (why[gist(r.message)] || 0) + 1;
  for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${n} x ${k}`);
  const slow = results.filter(r => r.ms).sort((a, b) => b.ms - a.ms)[0];
  if (slow) console.log(`slowest: seed ${slow.seed}, ${Math.round(slow.ms)} ms`);
  process.exitCode = count('fail') ? 1 : 0;
}
