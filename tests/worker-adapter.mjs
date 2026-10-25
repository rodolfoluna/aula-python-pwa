// Runs the real production worker with Node's worker_threads, without a browser.
import { parentPort, workerData } from 'node:worker_threads';
globalThis.self = globalThis;
globalThis.postMessage = value => parentPort.postMessage(value);
if (workerData?.offline) globalThis.fetch = async (...args) => {
  parentPort.postMessage({ type: 'network-attempt', url: String(args[0]) });
  throw new TypeError('Sin conexión en la prueba');
};
await import('../dist/python-worker.js');
parentPort.on('message', data => globalThis.self.onmessage({ data }));
