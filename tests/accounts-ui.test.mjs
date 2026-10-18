import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const html = await readFile(new URL('../accounts-public/index.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
let moduleId = 0;
async function setup(initialProfile) {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:4180' });
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.confirm = () => true;
  const calls = [], students = [], groups = [];
  const teacher = { id: 'teacher', name: 'Profesora', role: 'teacher', must_change_password: false };
  let profile = initialProfile || teacher;
  globalThis.fetch = async (url, options = {}) => {
    const data = options.body && JSON.parse(options.body); calls.push({ url, data }); let result;
    if (url === '/api/status') result = { configured: true };
    else if (url === '/api/me') result = { profile };
    else if (url === '/api/roster') result = { students, groups, memberships: [] };
    else if (url === '/api/my-groups') result = { groups: [{ name: 'Mi grupo' }] };
    else if (url === '/api/password') { profile = { ...profile, must_change_password: false }; result = { ok: true }; }
    else if (url === '/api/groups') { groups.push({ id: 'grupo', name: data.name }); result = { group: groups[0] }; }
    else if (url === '/api/students') { const created = data.rows.map((row, i) => ({ ...row, id: String(i), password: 'ClaveTemporalSoloTest123' })); students.push(...created.map(({ password, ...student }) => ({ ...student, active: true, must_change_password: true }))); result = { created, rejected: [] }; }
    else result = { ok: true };
    return { ok: true, json: async () => result };
  };
  const dialog = document.querySelector('dialog'); dialog.showModal = () => dialog.setAttribute('open', ''); dialog.close = () => dialog.removeAttribute('open');
  await import(`../accounts-public/app.js?test=${++moduleId}`);
  const $ = selector => document.querySelector(selector);
  const submit = async selector => { $(selector).dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle(); };
  return { dom, calls, $, submit };
}
test('administración UI crea grupo y alumno; muestra claves una vez sin guardarlas', async () => {
  const ui = await setup();
  assert.equal(ui.$('#teacher-panel').hidden, false);
  ui.$('#group-name').value = 'Grupo A'; await ui.submit('#group-form');
  assert.equal(ui.$('#group-count').textContent, '1');
  ui.$('#student-control').value = '000123'; ui.$('#student-name').value = 'Ana'; await ui.submit('#student-form');
  assert.equal(ui.$('#credentials-dialog').hasAttribute('open'), true); assert.match(ui.$('#credentials-table').textContent, /000123/);
  assert.equal(ui.dom.window.localStorage.length, 0);
  ui.$('#close-credentials').click(); assert.equal(ui.$('#credentials-table').textContent, '');
  assert.equal(ui.$('#student-count').textContent, '1'); ui.dom.window.close();
});
test('CSV UI muestra inválidos y envía únicamente filas válidas sin perder ceros', async () => {
  const ui = await setup(), input = ui.$('#csv-file');
  Object.defineProperty(input, 'files', { value: [{ size: 90, text: async () => 'numero_control,nombre\n001,Ana\n001,Duplicada\n@@,Error' }] });
  input.dispatchEvent(new ui.dom.window.Event('change')); await settle();
  assert.match(ui.$('#csv-summary').textContent, /1 alumnos válidos/); assert.equal(ui.$('#csv-preview').children.length, 3);
  ui.$('#confirm-csv').click(); await settle();
  const call = ui.calls.find(call => call.url === '/api/students'); assert.deepEqual(call.data.rows, [{ control: '001', name: 'Ana' }]); ui.dom.window.close();
});
test('alumno ve cambio obligatorio antes de sus grupos y no ve administración', async () => {
  const ui = await setup({ id: 'student', name: 'Ana', role: 'student', must_change_password: true });
  assert.equal(ui.$('#password-panel').hidden, false); assert.equal(ui.$('#student-panel').hidden, true); assert.equal(ui.$('#teacher-panel').hidden, true);
  ui.$('#current-password').value = 'Temporal12345'; ui.$('#new-password').value = 'NuevaClaveAlumno123'; ui.$('#repeat-password').value = 'NuevaClaveAlumno123';
  await ui.submit('#password-form'); assert.equal(ui.$('#password-panel').hidden, true); assert.equal(ui.$('#student-panel').hidden, false); assert.match(ui.$('#my-groups').textContent, /Mi grupo/);
  assert.equal(ui.$('#current-password').value, ''); ui.dom.window.close();
});
