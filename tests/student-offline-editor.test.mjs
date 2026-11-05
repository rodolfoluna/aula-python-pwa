import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { setupActivities } from '../accounts-public/activities.js';
import { setupPwa } from '../accounts-public/pwa.js';
import { OfflineWorkspace, indexedStore } from '../accounts-public/offline-store.js';
import { newActivity, newExercise, createCell, initialAnswer } from '../dist/activity-model.js';
import { applyAnswerPatch } from '../dist/answer-patch.js';

const html = await readFile(new URL('../accounts-public/index.html', import.meta.url), 'utf8');
const runnerHtml = await readFile(new URL('../dist/runner.html', import.meta.url), 'utf8');
const runnerSource = await readFile(new URL('../dist/runner.js', import.meta.url), 'utf8');
async function until(check) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > 30000) throw new Error('La prueba offline no terminó'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

for (const kind of ['files', 'notebook']) test(`alumno descargado: editor y Python offline, limpieza, reapertura y sincronización automática sin pérdida: ${kind}`, { timeout: 90000 }, async () => {
  const dom = new JSDOM(html, { url: 'https://aula.test/' });
  const previous = { navigator: globalThis.navigator, fetch: globalThis.fetch };
  const profile = { id: 'isolated-offline-student', role: 'student', name: 'Prueba aislada', must_change_password: false };
  const snapshot = newActivity(kind);
  if (kind === 'notebook') snapshot.content.cells.push(createCell('code'));
  else for (let i = 1; i < 7; i++) snapshot.content.exercises.push(newExercise());
  const server = { assignment: { id: 'downloaded', snapshot, activity_version: 1 }, answer: initialAnswer(snapshot), revision: 0, writable: true };
  const workspace = new OfflineWorkspace(indexedStore(new IDBFactory()));
  await workspace.prepare(profile, { configured: true, runnerOrigin: 'https://runner.test' }, { assignments: [{ id: 'downloaded', title: 'Descargada' }] }, { groups: [] }, [server]);
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, localStorage: dom.window.localStorage, confirm: () => true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  let online = false, writes = 0, networkAttempts = 0, failNextSave = true;
  Object.defineProperty(navigator, 'onLine', { get: () => online, configurable: true });
  globalThis.fetch = async () => { networkAttempts++; throw new TypeError('Red bloqueada'); };
  const api = async (path, payload) => {
    if (!online) {
      const cached = await workspace.read(profile, path, payload);
      if (cached) return cached;
      throw new TypeError('Sin conexión');
    }
    let result;
    if (path === 'me') return { profile };
    if (path === 'activity-open') result = structuredClone(server);
    else if (path === 'answer-save') {
      assert.equal(payload.actorId, profile.id); assert.equal(payload.revision, server.revision);
      if (failNextSave) { failNextSave = false; throw new TypeError('La conexión vuelve a fallar al guardar'); }
      writes++; server.answer = applyAnswerPatch(server.answer, payload.patch); server.revision++;
      result = { submission: { revision: server.revision, submitted_at: null } };
    } else if (path === 'activities') return { assignments: [{ id: 'downloaded', title: 'Descargada' }] };
    else throw new Error(path);
    await workspace.remember(profile, path, payload, result); return result;
  };
  const activities = setupActivities({ api, perform: fn => fn(), getProfile: () => profile, getGroups: () => [], getRunnerOrigin: () => 'https://runner.test' });
  const pwa = setupPwa({ workspace, api, getProfile: () => profile, getRunnerOrigin: () => 'https://runner.test', current: activities.current, perform: fn => fn() });
  const $ = selector => document.querySelector(selector);
  const button = text => [...document.querySelectorAll('button')].find(el => el.textContent === text);
  function edit(label, value) { const field = document.querySelector(`[aria-label="${label}"]`); assert.ok(field); field.value = value; field.dispatchEvent(new window.Event('input')); }
  const workers = new Set(), runners = [];
  async function connectRunner() {
    const frame = $('#runner-host iframe'), runner = new JSDOM(runnerHtml, { url: 'https://runner.test/runner.html?parent=https%3A%2F%2Faula.test', runScripts: 'outside-only' });
    runners.push(runner);
    const parentProxy = { postMessage: data => window.dispatchEvent(new window.MessageEvent('message', { source: frame.contentWindow, origin: 'https://runner.test', data })) };
    Object.defineProperty(runner.window, 'parent', { value: parentProxy });
    Object.assign(runner.window, { crossOriginIsolated: true, SharedArrayBuffer, Atomics, TextEncoder });
    runner.window.fetch = globalThis.fetch;
    runner.window.Worker = class {
      constructor() { this.worker = new Worker(new URL('./worker-adapter.mjs', import.meta.url), { workerData: { offline: true } }); workers.add(this.worker); this.worker.on('message', data => { if (data.type === 'network-attempt') networkAttempts++; this.onmessage?.({ data }); }); this.worker.on('error', error => this.onerror?.({ message: error.message })); }
      postMessage(data) { this.worker.postMessage(data); }
      terminate() { return this.worker.terminate(); }
    };
    frame.contentWindow.postMessage = data => runner.window.dispatchEvent(new runner.window.MessageEvent('message', { source: parentProxy, origin: 'https://aula.test', data }));
    runner.window.eval(runnerSource);
    return runner.window.document;
  }
  async function run(control, output, pattern) { control.click(); await until(() => pattern.test(output.textContent)); await until(() => !control.disabled); }
  try {
    await activities.setSession(profile); await button('Abrir actividad').onclick();
    const runner = await connectRunner();
    assert.equal($('#submit-answer').disabled, true);
    if (kind === 'files') {
      edit('Código de main.py', 'print("MAIN ORIGINAL")');
      button('Agregar archivo').click(); edit('Nombre del archivo Python', 'abierto.py'); button('Aceptar nombre').click();
      edit('Código de abierto.py', 'mensaje = "avance sin conexión: José 🐍"\nprint(mensaje)');
      await run(button('Ejecutar'), runner.querySelector('#outputs'), /José 🐍/);
      assert.doesNotMatch(runner.querySelector('#outputs').textContent, /MAIN ORIGINAL/);
      const before = structuredClone(activities.current().sync.answer);
      runner.querySelector('#clear').click(); assert.equal(runner.querySelector('#outputs').textContent, '');
      assert.deepEqual(activities.current().sync.answer, before);
      const destination = document.querySelector('[aria-label="Código de abierto.py"]');
      destination.setSelectionRange(destination.value.length, destination.value.length);
      button('Insertar desde archivo').click(); document.querySelector('.worksheet-copy-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
      assert.ok(destination.value.endsWith('print("MAIN ORIGINAL")'));
      assert.equal(activities.current().sync.answer.project.files['main.py'], 'print("MAIN ORIGINAL")');
      button('Siguiente →').click();
      assert.match(document.querySelector('[aria-label="Código de abierto.py"]').value, /José 🐍/);
      button('main.py').click(); await run(button('Ejecutar'), runner.querySelector('#outputs'), /MAIN ORIGINAL/);
    } else {
      edit('Contenido celda 2', 'valor = 41\nprint("José 🐍", valor)');
      edit('Contenido celda 3', 'print("CONSERVADO", valor + 1)');
      await run(button('Ejecutar todas'), document.querySelector('[aria-label="Salida celda 3"]'), /CONSERVADO 42/);
      assert.match(document.querySelector('[aria-label="Salida celda 2"]').textContent, /José 🐍 41/);
      const result = document.querySelector('[aria-label="Salida celda 3"]');
      assert.equal(result.closest('.worksheet-cell').querySelector('.worksheet-code').getAttribute('aria-label'), 'Contenido celda 3');
      const before = structuredClone(activities.current().sync.answer);
      button('Limpiar salidas').click(); assert.equal(result.hidden, true);
      assert.deepEqual(activities.current().sync.answer, before);
      await run([...document.querySelectorAll('button')].filter(el => el.textContent === 'Ejecutar celda')[1], result, /CONSERVADO 42/);
    }
    const expected = structuredClone(activities.current().sync.answer), key = `aula-answer:${profile.id}:downloaded`;
    assert.ok(localStorage.getItem(key)); assert.equal(writes, 0); assert.equal(networkAttempts, 0);
    await activities.setSession(null); await activities.setSession(profile); await button('Abrir actividad').onclick();
    assert.deepEqual(activities.current().sync.answer, expected, 'Reabrir offline conserva todos los archivos/celdas');
    // Use the real online listener and active DraftSync, including its differential save.
    online = true; window.dispatchEvent(new window.Event('online')); await pwa.wait();
    assert.equal(writes, 0); assert.ok(localStorage.getItem(key), 'Un fallo al reconectar no elimina el avance pendiente');
    assert.deepEqual(activities.current().sync.answer, expected);
    window.dispatchEvent(new window.Event('online')); await pwa.wait();
    assert.equal(writes, 1); assert.equal(localStorage.getItem(key), null);
    assert.deepEqual(server.answer, expected);
    assert.deepEqual((await workspace.read(profile, 'activity-open', { assignmentId: 'downloaded' })).answer, expected);
    window.dispatchEvent(new window.Event('online')); await pwa.wait(); assert.equal(writes, 1);
    assert.equal(networkAttempts, 0);
  } finally {
    await activities.setSession(null);
    for (const runner of runners) { runner.window.dispatchEvent(new runner.window.Event('pagehide')); runner.window.close(); }
    await Promise.all([...workers].map(worker => worker.terminate())); dom.window.close();
    globalThis.fetch = previous.fetch; Object.defineProperty(globalThis, 'navigator', { value: previous.navigator, configurable: true });
  }
});
