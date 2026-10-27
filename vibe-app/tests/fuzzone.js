// One fuzz part, run inside a worker thread by fuzz.js.

import { parentPort, workerData } from 'node:worker_threads';
import { tryPart } from './fuzzcheck.js';

parentPort.postMessage(tryPart(workerData));
