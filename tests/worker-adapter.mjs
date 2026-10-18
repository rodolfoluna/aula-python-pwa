// Runs the real production worker with Node's worker_threads, without a browser.
import { parentPort } from 'node:worker_threads';
globalThis.self = globalThis;
globalThis.postMessage = value => parentPort.postMessage(value);
await import('../dist/python-worker.js');
parentPort.on('message', data => globalThis.self.onmessage({ data }));
