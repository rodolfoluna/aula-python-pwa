import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
import { initialState, STORAGE_KEY } from '../dist/model.js';

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
async function waitFor(predicate, message, timeout = 60000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 20)); }
}

test('aplicación real en DOM de Node con worker Python real, sin navegador', { timeout: 150000 }, async t => {
  const dom = new JSDOM(html, { url: 'http://localhost' });
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.crossOriginIsolated = true;
  globalThis.confirm = () => true;
  const workers = new Set();
  globalThis.Worker = class {
    constructor(url) {
      assert.equal(url, '/python-worker.js');
      this.worker = new NodeWorker(new URL('./worker-adapter.mjs', import.meta.url)); workers.add(this);
      this.worker.on('message', data => this.onmessage?.({ data }));
      this.worker.on('error', error => this.onerror?.({ message: error.message }));
    }
    postMessage(data) { this.worker.postMessage(data); }
    terminate() { workers.delete(this); return this.worker.terminate(); }
  };
  const state = initialState();
  state.cells = state.cells.slice(0, 2); state.cells[0].locked = true;
  state.permissions = { add: true, delete: true, reorder: true };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const $ = selector => document.querySelector(selector);
  const change = (selector, value) => { const element = $(selector); element.value = value; element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
  async function run(selector) {
    $(selector).click();
    await waitFor(() => $('#stop').disabled, 'La ejecución no terminó');
  }
  try {
    await import('../dist/app.js');
    change('#role-selector', 'student');
    await t.test('segunda celda sola: conserva traceback y aviso de error después de terminar', async () => {
      await run('[aria-label="Ejecutar celda 2"]');
      assert.match($('[aria-label="Salida celda 2"]').textContent, /NameError/);
      assert.match($('#runtime-log').textContent, /Loading.*matplotlib/i);
      assert.doesNotMatch($('[aria-label="Salida celda 2"]').textContent, /Loading|building the font cache/i);
      await new Promise(resolve => setTimeout(resolve, 200));
      assert.match($('[aria-label="Salida celda 2"]').textContent, /NameError/);
      assert.match($('#runtime-state').textContent, /error/i);
    });
    await t.test('agregar una celda y cambiar de vista no borra el error anterior del alumno', async () => {
      $('#add-cell').click();
      assert.match($('[aria-label="Salida celda 2"]').textContent, /NameError/);
      change('#role-selector', 'teacher'); change('#role-selector', 'student');
      assert.match($('[aria-label="Salida celda 2"]').textContent, /NameError/);
    });
    await t.test('Ejecutar todas en alumno comparte variables y corrige la segunda celda', async () => {
      await run('#run-all');
      assert.match($('[aria-label="Salida celda 1"]').textContent, /Datos preparados/);
      assert.match($('[aria-label="Salida celda 2"]').textContent, /15\.8/);
      assert.doesNotMatch($('[aria-label="Salida celda 2"]').textContent, /NameError/);
      assert.match($('#runtime-state').textContent, /Python listo/);
    });
    await t.test('alumno ejecuta input y gráfica con la aplicación y el motor reales', async () => {
      const inputCell = $('[aria-label="Código celda 3"]');
      inputCell.value = initialState().cells[2].code;
      inputCell.dispatchEvent(new dom.window.Event('input'));
      $('#add-cell').click();
      const figureCell = $('[aria-label="Código celda 4"]');
      figureCell.value = initialState().cells[3].code;
      figureCell.dispatchEvent(new dom.window.Event('input'));
      $('#run-all').click();
      await waitFor(() => !$('#input-dock').hidden, 'No apareció la entrada de Python');
      assert.match($('#input-prompt').textContent, /Cómo te llamas/);
      $('#stdin').value = 'José 🐍';
      $('#input-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(() => $('#stop').disabled, 'La gráfica no terminó');
      assert.match($('[aria-label="Salida celda 3"]').textContent, /José 🐍.*15\.8/);
      assert.match($('[aria-label="Salida celda 4"] img').src, /^data:image\/png;base64,iVBOR/);
      assert.doesNotMatch($('[aria-label="Salida celda 4"]').textContent, /Loading|building the font cache/i);
      assert.equal($('[aria-label="Código celda 1"]').readOnly, true);
    });
  } finally {
    if (!$('#reset-runtime').disabled) $('#reset-runtime').click();
    for (const worker of workers) await worker.terminate();
    dom.window.close();
  }
});
