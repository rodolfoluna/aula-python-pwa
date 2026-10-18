import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { Worker as NodeWorker } from 'node:worker_threads';
test('consola aislada: protocolo de origen, Python real, input, gráficas y archivos', { timeout: 90000 }, async () => {
  const html = await readFile(new URL('../dist/runner.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:4173/runner.html?parent=http%3A%2F%2F127.0.0.1%3A4180' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.location = dom.window.location; globalThis.parent = dom.window; globalThis.crossOriginIsolated = true;
  const notices = [], workers = new Set(); parent.postMessage = (data, origin) => notices.push({ data, origin });
  globalThis.Worker = class {
    constructor() { this.worker = new NodeWorker(new URL('./worker-adapter.mjs', import.meta.url)); workers.add(this); this.worker.on('message', data => this.onmessage?.({ data })); this.worker.on('error', error => this.onerror?.({ message: error.message })); }
    postMessage(data) { this.worker.postMessage(data); }
    terminate() { workers.delete(this); return this.worker.terminate(); }
  };
  const $ = selector => document.querySelector(selector);
  const send = (data, origin = 'http://127.0.0.1:4180') => window.dispatchEvent(new dom.window.MessageEvent('message', { data, origin, source: parent }));
  async function wait(predicate) { const start = Date.now(); while (!predicate()) { if (Date.now() - start > 20000) throw new Error('La consola no respondió: ' + $('#state').textContent + ' / ' + $('#outputs').textContent); await new Promise(resolve => setTimeout(resolve, 10)); } }
  try {
    await import('../dist/runner.js'); assert.equal(notices[0].data.type, 'aula-ready');
    send({ type: 'aula-run', items: [{ payload: { mode: 'notebook', code: 'print("origen incorrecto")' } }] }, 'http://ejemplo.invalid'); assert.equal(workers.size, 0);
    send({ type: 'aula-run', items: [{ label: 'Datos', payload: { mode: 'notebook', code: 'valor=41' } }, { label: 'Usar variable', payload: { mode: 'notebook', code: 'print(valor+1)' } }] });
    await wait(() => $('#state').textContent === 'Ejecución completada'); assert.match($('#outputs').textContent, /42/); assert.doesNotMatch($('#outputs').textContent, /building the font cache/);
    send({ type: 'aula-run', items: [{ payload: { mode: 'notebook', code: 'nombre=input("Nombre: ")\nprint("Hola",nombre)\nimport matplotlib.pyplot as plt\nplt.plot([1,2],[3,4])\nplt.show()' } }] });
    await wait(() => !$('#input-form').hidden); $('#input').value = 'Ana'; $('#input-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await wait(() => $('#state').textContent === 'Ejecución completada'); assert.match($('#outputs').textContent, /Hola Ana/); assert.match($('#outputs img').src, /^data:image\/png;base64,iVBOR/);
    const previousOutputs = $('#outputs').children.length;
    send({ type: 'aula-run', items: [{ payload: { mode: 'files', entry: 'main.py', files: { 'main.py': 'from funciones import doble\nprint(doble(21))', 'funciones.py': 'def doble(x): return x*2' } } }] });
    await wait(() => $('#outputs').children.length > previousOutputs && $('#state').textContent === 'Ejecución completada'); assert.match($('#outputs').lastElementChild.textContent, /42/);
    const paste = new dom.window.Event('paste', { cancelable: true, bubbles: true }); $('#input').dispatchEvent(paste); assert.equal(paste.defaultPrevented, true);
    $('#reset').click();
  } finally { window.dispatchEvent(new dom.window.Event('pagehide')); await new Promise(resolve => setImmediate(resolve)); for (const worker of workers) await worker.terminate(); dom.window.close(); }
});
