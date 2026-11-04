import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { OfflineWorkspace, indexedStore } from '../accounts-public/offline-store.js';
import { DraftSync } from '../accounts-public/draft-sync.js';
import { setupPwa, syncPending } from '../accounts-public/pwa.js';
import { createWorksheet } from '../accounts-public/worksheet.js';
import { setupActivities } from '../accounts-public/activities.js';
import { newActivity, newExercise, initialAnswer } from '../dist/activity-model.js';
import { applyAnswerPatch } from '../dist/answer-patch.js';

const html = await readFile(new URL('../accounts-public/index.html', import.meta.url), 'utf8');
const profile = { id: 'upgrade-student', role: 'student', teacher_id: 'teacher', name: 'Alumno de prueba', must_change_password: false };
const key = `aula-answer:${profile.id}:one`;
async function until(predicate) {
  const start = performance.now();
  while (!predicate()) { if (performance.now() - start > 5000) throw new Error('La interfaz no terminó'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
function bind(dom, database) {
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, localStorage: dom.window.localStorage, indexedDB: database, confirm: () => true });
  Object.defineProperty(dom.window.navigator, 'onLine', { value: false, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
}

for (const kind of ['notebook', 'files']) test(`actualización y reinicio offline conservan el avance y sincronizan una sola vez al reconectar: ${kind}`, async () => {
  const previousNavigator = globalThis.navigator, previousFetch = globalThis.fetch, previousInterval = globalThis.setInterval, previousTimeout = globalThis.setTimeout;
  const intervals = [], runnerTimers = [], database = new IDBFactory(), snapshot = newActivity(kind);
  if (kind === 'files') for (let i = 1; i < 7; i++) snapshot.content.exercises.push(newExercise());
  const data = { assignment: { id: 'one', snapshot, activity_version: 1 }, answer: initialAnswer(snapshot), revision: 0, writable: true };
  if (kind === 'files') data.answer.exercises[3].files['main.py'] = 'print("avance_del_ejercicio_4")';
  const workspace = new OfflineWorkspace(indexedStore(database));
  await workspace.prepare(profile, { configured: true, runnerOrigin: 'https://runner.test' }, { assignments: [{ id: 'one', title: 'Actividad descargada', activity_version: 1 }] }, { groups: [{ name: 'Grupo descargado' }] }, [data]);
  const oldDom = new JSDOM(html, { url: 'https://aula.test/' }); let newDom, worksheet;
  globalThis.setInterval = (...args) => { const timer = previousInterval(...args); intervals.push(timer); return timer; };
  globalThis.setTimeout = (callback, delay, ...args) => { const timer = previousTimeout(callback, delay, ...args); if (delay === 15000) runnerTimers.push(timer); return timer; };
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new TypeError('Red bloqueada por la prueba'); };
  try {
    bind(oldDom, database);
    localStorage.setItem('aula-theme', 'dark');
    localStorage.setItem('aula-answer:otro-alumno:otra', 'avance ajeno conservado');
    const sync = new DraftSync({ key, answer: data.answer, revision: 0, storage: localStorage, delta: true, save: () => { throw new Error('No debe guardar online durante la actualización'); } });
    const work = sync.answer;
    worksheet = createWorksheet(document.querySelector('#worksheet'), { activity: snapshot, answer: work, role: 'student', onChange: () => sync.set(work) });
    const code = [...document.querySelectorAll('.worksheet-code')].find(field => !field.readOnly);
    code.value = 'print("antes_de_actualizar")'; code.dispatchEvent(new window.Event('input'));
    const pending = localStorage.getItem(key); assert.ok(pending.includes('antes_de_actualizar'));
    const listeners = {}, messages = []; let action, reloads = 0;
    const registration = { waiting: { postMessage: message => messages.push(message) }, addEventListener() {} };
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: async () => registration, ready: Promise.resolve(registration), addEventListener: (name, callback) => { listeners[name] = callback; } } });
    setupPwa({ workspace, getProfile: () => profile, getRunnerOrigin: () => 'https://runner.test', current: () => ({ assignmentId: 'one', sync }), canReload: () => { sync.cache(); return !sync.cacheFailed; }, perform: fn => { action = fn(); }, reload: () => reloads++ });
    await new Promise(resolve => setImmediate(resolve));
    listeners.controllerchange(); assert.equal(reloads, 0, 'No debe recargar por una actualización no solicitada');
    document.querySelector('#update-app').click(); await action;
    assert.deepEqual(messages, [{ type: 'activate-update' }]);
    listeners.controllerchange(); listeners.controllerchange(); assert.equal(reloads, 1);
    assert.equal(localStorage.getItem(key), pending);
    const persisted = Array.from({ length: localStorage.length }, (_, i) => [localStorage.key(i), localStorage.getItem(localStorage.key(i))]);
    worksheet.destroy(); worksheet = null; oldDom.window.close();

    // The new app process receives only the browser's persistent stores, no old
    // in-memory editor or sync object. Every network request is rejected.
    newDom = new JSDOM(html, { url: 'https://aula.test/' }); bind(newDom, database);
    for (const [name, value] of persisted) localStorage.setItem(name, value);
    document.querySelector('dialog').close = () => {};
    await import(`../accounts-public/app.js?upgrade-offline-${kind}`);
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Abrir actividad').click();
    await until(() => document.querySelector('.worksheet-code'));
    let reopened = [...document.querySelectorAll('.worksheet-code')].find(field => !field.readOnly);
    assert.equal(reopened.value, 'print("antes_de_actualizar")');
    assert.match(document.querySelector('#my-groups').textContent, /Grupo descargado/);
    if (kind === 'files') {
      assert.match(document.querySelector('.exercise-counter').textContent, /1 de 7/);
      [...document.querySelectorAll('button')].find(button => button.textContent === 'Siguiente →').click();
      reopened = document.querySelector('[aria-label="Código de main.py"]');
      assert.equal(reopened.value, 'print("antes_de_actualizar")');
      const recovered = JSON.parse(localStorage.getItem(key));
      assert.ok(Object.values(recovered.answer.project.files).includes('print("avance_del_ejercicio_4")'));
    }
    reopened.value = 'print("despues_de_actualizar_offline")'; reopened.dispatchEvent(new window.Event('input'));
    assert.equal(document.querySelector('#submit-answer').disabled, true);
    assert.ok(localStorage.getItem(key).includes('despues_de_actualizar_offline'));
    assert.ok(requests > 0, 'La app tuvo que usar la copia preparada tras fallar la red');
    assert.equal(localStorage.getItem('aula-theme'), 'dark');
    assert.equal(localStorage.getItem('aula-answer:otro-alumno:otra'), 'avance ajeno conservado');
    // Reconnect through the same idempotent synchronization used by the app.
    let writes = 0; const server = structuredClone(data);
    const api = async (path, payload) => {
      let result;
      if (path === 'me') return { profile };
      if (path === 'activity-open') result = structuredClone(server);
      else if (path === 'answer-save') {
        assert.equal(payload.actorId, profile.id); assert.equal(payload.revision, server.revision);
        writes++; server.answer = applyAnswerPatch(server.answer, payload.patch); server.revision++;
        result = { submission: { revision: server.revision, submitted_at: null } };
      } else throw new Error(path);
      await workspace.remember(profile, path, payload, result); return result;
    };
    assert.deepEqual(await syncPending({ profile, storage: localStorage, api }), { saved: 1, held: 0 });
    await syncPending({ profile, storage: localStorage, api });
    assert.equal(writes, 1); assert.equal(localStorage.getItem(key), null);
    const savedCode = kind === 'files' ? server.answer.project.files['main.py'] : server.answer.cells[1].code;
    assert.equal(savedCode, 'print("despues_de_actualizar_offline")');
    assert.deepEqual((await workspace.read(profile, 'activity-open', { assignmentId: 'one' })).answer, server.answer);
  } finally {
    worksheet?.destroy(); intervals.forEach(clearInterval); runnerTimers.forEach(clearTimeout);
    newDom?.window.close(); oldDom.window.close(); globalThis.fetch = previousFetch; globalThis.setInterval = previousInterval; globalThis.setTimeout = previousTimeout;
    Object.defineProperty(globalThis, 'navigator', { value: previousNavigator, configurable: true });
  }
});

test('actualizar se bloquea si no se puede persistir el avance, durante un guardado o durante ejecución', async () => {
  const dom = new JSDOM(html, { url: 'https://aula.test/' }), previousNavigator = globalThis.navigator;
  bind(dom, new IDBFactory());
  const snapshot = newActivity(), data = { assignment: { id: 'one', snapshot, activity_version: 1 }, answer: initialAnswer(snapshot), revision: 0, writable: true };
  let full = true, finishSave, confirmed = 0;
  const records = new Map();
  globalThis.localStorage = { getItem: key => records.get(key) || null, setItem: (key, value) => { if (full) throw new Error('QuotaExceededError'); records.set(key, value); }, removeItem: key => records.delete(key) };
  globalThis.confirm = () => { confirmed++; return true; };
  const api = async path => {
    if (path === 'activities') return { assignments: [{ id: 'one', title: 'Prueba de actualización', activity_version: 1 }] };
    if (path === 'activity-open') return structuredClone(data);
    if (path === 'answer-save') return new Promise(resolve => { finishSave = () => resolve({ submission: { revision: 1 } }); });
    throw new Error(path);
  };
  const activities = setupActivities({ api, perform: fn => fn(), getGroups: () => [], getProfile: () => profile, getRunnerOrigin: () => 'https://runner.test' });
  try {
    await activities.setSession(profile);
    await [...document.querySelectorAll('button')].find(button => button.textContent === 'Abrir actividad').onclick();
    const code = document.querySelector('[aria-label="Contenido celda 2"]');
    code.value = 'avance_que_no_debe_perderse = 42'; code.dispatchEvent(new window.Event('input'));
    assert.equal(activities.canReload(), false); assert.equal(confirmed, 0);
    assert.match(document.querySelector('#activities-notice').textContent, /No se puede actualizar/);
    assert.equal(code.value, 'avance_que_no_debe_perderse = 42');
    full = false;
    assert.equal(activities.canReload(), true); assert.equal(confirmed, 1);
    assert.ok(records.get(key).includes('avance_que_no_debe_perderse'));
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    const saving = document.querySelector('#save-answer').onclick();
    await until(() => !!finishSave);
    assert.equal(activities.canReload(), false);
    assert.match(document.querySelector('#activities-notice').textContent, /termine el guardado/);
    finishSave(); await saving;
    const frame = document.querySelector('#runner-host iframe');
    window.dispatchEvent(new window.MessageEvent('message', { source: frame.contentWindow, origin: 'https://runner.test', data: { type: 'aula-busy', busy: true } }));
    assert.equal(activities.canReload(), false);
    window.dispatchEvent(new window.MessageEvent('message', { source: frame.contentWindow, origin: 'https://runner.test', data: { type: 'aula-busy', busy: false } }));
    assert.equal(activities.canReload(), true);
  } finally { finishSave?.(); await activities.setSession(null); dom.window.close(); Object.defineProperty(globalThis, 'navigator', { value: previousNavigator, configurable: true }); }
});
