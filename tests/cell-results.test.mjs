import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { newActivity, createCell, initialAnswer } from '../dist/activity-model.js';
import { createWorksheet } from '../accounts-public/worksheet.js';
import { setupActivities } from '../accounts-public/activities.js';

test('salidas Jupyter: cada celda mantiene sus resultados, errores, gráficas y entrada tras renderizar o reordenar', () => {
  const dom = new JSDOM('<div id="root"></div>'); Object.assign(globalThis, { document: dom.window.document, window: dom.window });
  const activity = newActivity(), cells = activity.content.cells; cells.push(createCell('code'));
  const root = document.querySelector('#root'), inputs = []; let jobs;
  const editor = createWorksheet(root, { activity, role: 'teacher', run: items => { jobs = items; }, sendInput: value => inputs.push(value) });
  const button = text => [...root.querySelectorAll('button')].find(control => control.textContent === text);
  const emit = (cell, kind, rest = {}) => editor.receiveOutput({ cellId: cell.id, kind, ...rest });
  try {
    button('Ejecutar todas').click(); assert.deepEqual(jobs.map(job => job.cellId), [cells[1].id, cells[2].id]);
    emit(cells[1], 'start', { execution: 1 }); emit(cells[1], 'text', { channel: 'stderr', text: 'NameError: <script>alert(1)</script>' }); emit(cells[1], 'done', { ok: false });
    emit(cells[2], 'start', { execution: 2 }); emit(cells[2], 'text', { channel: 'stdout', text: '42\n' });
    emit(cells[2], 'figure', { data: 'iVBORw0KGgo=' }); emit(cells[2], 'input');
    const output = root.querySelector('[aria-label="Salida celda 3"]');
    assert.equal(output.closest('.worksheet-cell').querySelector('.worksheet-code').getAttribute('aria-label'), 'Contenido celda 3');
    assert.match(root.querySelector('[aria-label="Salida celda 2"]').textContent, /NameError/); assert.equal(root.querySelector('script'), null);
    assert.ok(output.querySelector('img').src.startsWith('data:image/png;base64,'));
    output.querySelector('input').value = 'José 🐍'; output.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.deepEqual(inputs, ['José 🐍']); emit(cells[2], 'input-sent'); emit(cells[2], 'done', { ok: true });
    [cells[1], cells[2]] = [cells[2], cells[1]]; editor.render();
    assert.match(root.querySelector('[aria-label="Salida celda 2"]').textContent, /42/);
    assert.match(root.querySelector('[aria-label="Salida celda 3"]').textContent, /NameError/);
    emit(cells[1], 'start', { execution: 3 }); emit(cells[1], 'text', { channel: 'stdout', text: '99' }); emit(cells[1], 'done', { ok: true });
    assert.match(root.querySelector('[aria-label="Salida celda 2"]').textContent, /99/);
    assert.doesNotMatch(root.querySelector('[aria-label="Salida celda 2"]').textContent, /42/);
    assert.match(root.querySelector('[aria-label="Salida celda 3"]').textContent, /NameError/);
    button('Limpiar salidas').click(); assert.equal(root.querySelector('[aria-label="Salida celda 3"]').hidden, true);
  } finally { editor.destroy(); dom.window.close(); }
});

test('el aula enlaza los resultados al notebook, valida origen y conserva el iframe al cambiar celdas', async () => {
  const html = await readFile(new URL('../accounts-public/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://aula.test' });
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, location: dom.window.location, localStorage: dom.window.localStorage, confirm: () => true });
  const profile = { id: 'student', role: 'student', name: 'Ana' }, snapshot = newActivity(); snapshot.content.permissions.add = true;
  const api = async path => path === 'activities' ? { assignments: [{ id: 'one', title: 'Notebook' }] } : { assignment: { id: 'one', snapshot, activity_version: 1 }, answer: initialAnswer(snapshot), revision: 0, writable: true };
  const activities = setupActivities({ api, perform: fn => fn(), getProfile: () => profile, getGroups: () => [], getRunnerOrigin: () => 'https://runner.test' });
  try {
    await activities.setSession(profile);
    await [...document.querySelectorAll('button')].find(button => button.textContent === 'Abrir actividad').onclick();
    const frame = document.querySelector('#runner-host iframe'), messages = [];
    frame.contentWindow.postMessage = data => messages.push(data);
    const send = (data, origin = 'https://runner.test') => window.dispatchEvent(new window.MessageEvent('message', { source: frame.contentWindow, origin, data }));
    send({ type: 'aula-ready' }); assert.equal(document.querySelector('#execution-area').hidden, false);
    assert.match(document.querySelector('#activities-notice').textContent, /actualizando/);
    send({ type: 'aula-ready', protocol: 2 }); assert.equal(document.querySelector('#execution-area').hidden, true);
    assert.equal(document.querySelector('#activities-notice').hidden, true);
    const cellId = snapshot.content.cells[1].id;
    send({ type: 'aula-cell-output', cellId, kind: 'text', text: 'No permitido' }, 'https://other.test');
    assert.equal(document.querySelector('[aria-label="Salida celda 2"]').hidden, true);
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Ejecutar celda').click();
    assert.equal(messages.at(-1).items[0].cellId, cellId);
    send({ type: 'aula-cell-output', cellId, kind: 'start', execution: 1 });
    send({ type: 'aula-cell-output', cellId, kind: 'text', text: 'Resultado local', channel: 'stdout' });
    send({ type: 'aula-cell-output', cellId, kind: 'input' });
    const form = document.querySelector('[aria-label="Salida celda 2"] form'); form.querySelector('input').value = 'Ana'; form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.deepEqual(messages.at(-1), { type: 'aula-input', value: 'Ana' });
    send({ type: 'aula-cell-output', cellId, kind: 'done', ok: true }); send({ type: 'aula-busy', busy: false });
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Agregar celda').click();
    assert.equal(document.querySelector('#runner-host iframe'), frame);
    assert.match(document.querySelector('[aria-label="Salida celda 2"]').textContent, /Resultado local/);
  } finally { await activities.setSession(null); dom.window.close(); }
});
