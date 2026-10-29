// Runs every part in curved100.js through the page's path and the 3D checker, each part in its own
// worker thread. `node tests/curvedrun.js` for all of them, `node tests/curvedrun.js 5 12` for some,
// and `--only wood` (or `quarterBall`, ...) for one material or bit, `--limit 1800` for more than
// 600 s a part. Writes the full results to the file named by `--out`.

import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parts } from './curved100.js';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1]; };
// ms for one part, all its runs and their checks (the checker takes far longer than the CAM on a big part)
const TIME_LIMIT = +(flag('--limit') || 600) * 1000;
const only = flag('--only'), outFile = flag('--out');
const threads = +(flag('--threads') || Math.max(1, Math.min(12, availableParallelism() - 2)));
const all = parts().map((p, i) => i);
const picked = args.length ? args.map(Number) : all;

const results = [];
await new Promise(resolve => {
  let next = 0, busy = 0;
  const start = () => {
    while (busy < threads && next < picked.length) {
      const index = picked[next++];
      busy++;
      const w = new Worker(fileURLToPath(new URL('./curvedone.js', import.meta.url)), { workerData: { index, only }, resourceLimits: { maxOldGenerationSizeMb: 4096 } });
      let done = false;
      const finish = r => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        w.terminate();
        results.push(r);
        const bad = r.runs.filter(x => x.problems.length);
        console.log(`${String(r.index).padStart(3)} ${bad.length ? 'FAIL' : 'ok  '} ${r.name}${bad.length ? `\n      ${bad.map(x => `${x.material} ${x.ball}: ${x.problems.slice(0, 3).join(' / ')}`).join('\n      ')}` : ''}`);
        busy--;
        if (results.length === picked.length) resolve();
        else start();
      };
      const timer = setTimeout(() => finish({ index, name: `#${index}`, runs: [{ problems: [`hung for over ${TIME_LIMIT / 1000} s`], flags: [] }] }), TIME_LIMIT);
      w.on('message', finish);
      w.on('error', e => finish({ index, name: `#${index}`, runs: [{ problems: [`worker crashed: ${e.stack || e}`], flags: [] }] }));
      w.on('exit', () => finish({ index, name: `#${index}`, runs: [{ problems: ['worker quit without an answer'], flags: [] }] }));
    }
  };
  start();
});

results.sort((a, b) => a.index - b.index);
const runs = results.flatMap(r => r.runs.map(x => ({ ...x, name: r.name, index: r.index })));
const failed = results.filter(r => r.runs.some(x => x.problems.length));
console.log(`\n${results.length} parts, ${runs.length} runs: ${results.length - failed.length} parts pass, ${failed.length} fail`);
const kinds = {};
for (const x of runs) kinds[x.outcome] = (kinds[x.outcome] || 0) + 1;
console.log('outcomes:', JSON.stringify(kinds));
console.log('\nflags:');
for (const x of runs) if (x.flags?.length) console.log(`  ${x.index} ${x.name} [${x.material} ${x.ball}]: ${x.flags.join('; ')}`);
console.log('\nslowest:');
for (const x of [...runs].sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, 10)) console.log(`  ${((x.ms || 0) / 1000).toFixed(1)} s  ${x.name} [${x.material} ${x.ball}] ${x.lines || ''} lines, ${Math.round(x.minutes || 0)} min`);
if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 1));
process.exitCode = failed.length ? 1 : 0;
