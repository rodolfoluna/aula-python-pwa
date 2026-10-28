import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { indexedStore, OfflineWorkspace } from '../accounts-public/offline-store.js';
import { syncPending } from '../accounts-public/pwa.js';
import { DraftSync } from '../accounts-public/draft-sync.js';
import { initialAnswer, newActivity } from '../dist/activity-model.js';
import { applyAnswerPatch, answerPatch } from '../dist/answer-patch.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
const profile = { id: 'student', role: 'student', name: 'Ana', must_change_password: false };
function opened(id = 'one') { const snapshot = newActivity(); return { assignment: { id, snapshot }, answer: initialAnswer(snapshot), revision: 0, writable: true }; }
function storage() { const data = new Map(); return { get length() { return data.size; }, key: n => [...data.keys()][n], getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }; }

test('IndexedDB conserva actividades tras reinicio, separa alumnos y elimina acceso local al salir', async () => {
  const database = new IDBFactory(), first = new OfflineWorkspace(indexedStore(database)), data = opened();
  await first.prepare(profile, { configured: true }, { assignments: [{ id: 'one' }] }, { groups: [] }, [data]);
  const reboot = new OfflineWorkspace(indexedStore(database)); await reboot.load();
  assert.equal((await reboot.read(null, 'me')).profile.id, profile.id); assert.equal(reboot.needsIdentity, true);
  assert.deepEqual((await reboot.read(profile, 'activity-open', { assignmentId: 'one' })).answer, data.answer);
  assert.equal(await reboot.read({ ...profile, id: 'another' }, 'activities'), null);
  assert.equal(await reboot.read(profile, 'roster'), null);
  assert.equal(await reboot.read(profile, 'activity-open', { assignmentId: 'one', studentId: 'other' }), null);
  await assert.rejects(first.prepare({ ...profile, role: 'teacher' }, {}, {}, {}, []));
  await reboot.deactivate();
  assert.equal(await reboot.store.get('active'), undefined); assert.equal(await reboot.store.get('user:student:activity-open:one'), undefined);
});

test('copia offline se actualiza solo con recibo confirmado y respeta entregas y fechas', async () => {
  const workspace = new OfflineWorkspace(indexedStore(new IDBFactory())), data = opened();
  await workspace.prepare(profile, {}, {}, {}, [data]);
  const changed = structuredClone(data.answer); changed.cells[1].code = 'print(42)'; const patch = answerPatch(data.answer, changed);
  await workspace.remember(profile, 'answer-save', { assignmentId: 'one', revision: 0, patch, requestId: 'request' }, { submission: { revision: 1 } });
  assert.equal((await workspace.read(profile, 'activity-open', { assignmentId: 'one' })).answer.cells[1].code, 'print(42)');
  await workspace.remember(profile, 'activity-open', { assignmentId: 'one' }, { ...data, submission: { submitted_at: new Date().toISOString() } });
  assert.equal((await workspace.read(profile, 'activity-open', { assignmentId: 'one' })).writable, false);
  await workspace.remember(profile, 'activity-open', { assignmentId: 'one' }, { ...data, assignment: { ...data.assignment, due_at: '2000-01-01' } });
  assert.equal((await workspace.read(profile, 'activity-open', { assignmentId: 'one' })).writable, false);
});

function backend(records, identity = profile) {
  const calls = [];
  return { calls, api: async (path, payload) => {
    calls.push({ path, payload });
    if (path === 'me') return { profile: identity };
    const record = records[payload.assignmentId];
    if (path === 'activity-open') return structuredClone(record);
    if (path === 'answer-save') {
      assert.equal(payload.actorId, profile.id);
      assert.equal(payload.revision, record.revision);
      record.answer = applyAnswerPatch(record.answer, payload.patch); record.revision++;
      record.submission = { revision: record.revision, last_save_id: payload.requestId };
      return { submission: record.submission };
    }
  } };
}
function edit(local, data, code) {
  const draft = new DraftSync({ key: `aula-answer:student:${data.assignment.id}`, storage: local, answer: data.answer, revision: data.revision, delta: true });
  const answer = structuredClone(data.answer); answer.cells[1].code = code; draft.set(answer); return draft;
}
test('reconexión sincroniza varias actividades tras cerrar el editor, sin reenviar las limpias', async () => {
  const local = storage(), records = { one: opened(), two: opened('two') }, server = backend(records);
  edit(local, records.one, 'x=1'); edit(local, records.two, 'y=2');
  assert.deepEqual(await syncPending({ profile, storage: local, api: server.api }), { saved: 2, held: 0 });
  assert.equal(records.one.answer.cells[1].code, 'x=1'); assert.equal(records.two.answer.cells[1].code, 'y=2'); assert.equal(local.length, 0);
  await syncPending({ profile, storage: local, api: server.api }); assert.equal(server.calls.filter(c => c.path === 'answer-save').length, 2);
});
test('reconexión rechaza otra cuenta y conserva conflictos, cierres y permisos cambiados', async () => {
  const local = storage(), records = { one: opened(), two: opened('two') };
  edit(local, records.one, 'x=1'); edit(local, records.two, 'y=2');
  await assert.rejects(syncPending({ profile, storage: local, api: backend(records, { ...profile, id: 'another' }).api }), /dueña/);
  records.one.revision = 3; records.two.writable = false;
  const server = backend(records);
  assert.deepEqual(await syncPending({ profile, storage: local, api: server.api }), { saved: 0, held: 2 });
  assert.equal(local.length, 2); assert.equal(server.calls.filter(c => c.path === 'answer-save').length, 0);
});
test('recibo perdido se reconoce al reconectar y no duplica la escritura', async () => {
  const local = storage(), records = { one: opened() }, draft = edit(local, records.one, 'x=42'), server = backend(records);
  draft.saveRequest = async payload => { await server.api('answer-save', { assignmentId: 'one', actorId: profile.id, ...payload }); throw new TypeError('Red perdida'); };
  await assert.rejects(draft.flush());
  await syncPending({ profile, storage: local, api: server.api });
  assert.equal(records.one.revision, 1); assert.equal(local.length, 0);
  assert.equal(server.calls.filter(c => c.path === 'answer-save').length, 1);
});

async function workerHarness(file, assets) {
  const handlers = {}, stores = new Map(), network = []; let updates = 0;
  const caches = { keys: async () => [...stores.keys()], delete: async k => stores.delete(k), open: async name => {
    if (!stores.has(name)) stores.set(name, new Map()); const map = stores.get(name);
    return { addAll: async paths => { for (const path of paths) map.set(typeof path === 'string' ? path : path.url, new Response('public', { headers: { 'Cross-Origin-Embedder-Policy': 'require-corp' } })); }, match: async key => map.get(key)?.clone(), put: async (key, value) => map.set(key, value.clone()) };
  } };
  const context = { self: { skipWaiting: async () => { updates++; }, location: { origin: 'https://app.test' }, clients: { claim: async () => {} }, AULA_SHELL: { version: 'test', assets: ['/', '/app.js'] }, addEventListener: (name, callback) => handlers[name] = callback }, caches, URL, Request: class { constructor(url) { this.url = url; } }, Response, Uint8Array, crypto: webcrypto,
    importScripts() {}, fetch: async (url, options) => { network.push({ url, options }); if (assets?.[url]) return new Response(assets[url]); throw new TypeError('Offline'); } };
  vm.runInNewContext(await readFile(new URL('../' + file, import.meta.url), 'utf8'), context);
  const event = async (name, data = {}) => { let promise; handlers[name]({ ...data, waitUntil: p => promise = p, respondWith: p => promise = p }); return await promise; };
  return { event, stores, caches, network, updates: () => updates };
}
test('service worker guarda solo interfaz pública, conserva aislamiento y no intercepta API', async () => {
  const worker = await workerHarness('accounts-public/sw.js'); await worker.event('install'); assert.equal(worker.updates(), 0);
  await worker.event('message', { data: { type: 'unrelated' } }); assert.equal(worker.updates(), 0);
  await worker.event('message', { data: { type: 'activate-update' } }); assert.equal(worker.updates(), 1);
  await worker.event('activate');
  const response = await worker.event('fetch', { request: { method: 'GET', url: 'https://app.test/', mode: 'navigate' } });
  assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.equal(await worker.event('fetch', { request: { method: 'GET', url: 'https://app.test/api/me' } }), undefined);
  assert.equal(await worker.event('fetch', { request: { method: 'POST', url: 'https://app.test/api/answer-save' } }), undefined);
  assert.equal(worker.network.length, 0);
});
test('Python offline verifica integridad, descarga sin credenciales y reutiliza todos los archivos', async () => {
  const url = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/python_stdlib.zip', bytes = 'python-test';
  const worker = await workerHarness('dist/runner-sw.js', { [url]: bytes }); await worker.event('install');
  const shell = await worker.caches.open('aula-runner-shell-__RUNNER_VERSION__');
  const manifest = hash => new Response(JSON.stringify({ assets: [{ url, sha256: hash }] }));
  await shell.put('/runtime-assets.json', manifest('invalid')); const messages = [];
  await worker.event('message', { data: { type: 'prepare-python' }, ports: [{ postMessage: m => messages.push(m) }] });
  assert.match(messages.at(-1).error, /integridad/);
  await shell.put('/runtime-assets.json', manifest(createHash('sha256').update(bytes).digest('hex')));
  await worker.event('message', { data: { type: 'prepare-python' }, ports: [{ postMessage: m => messages.push(m) }] });
  assert.equal(messages.at(-1).ready, true); assert.equal(worker.network[0].options.credentials, 'omit');
  const before = worker.network.length;
  await worker.event('message', { data: { type: 'prepare-python' }, ports: [{ postMessage: m => messages.push(m) }] });
  assert.equal(worker.network.length, before);
  assert.equal(await (await worker.event('fetch', { request: { method: 'GET', url } })).text(), bytes);
});
