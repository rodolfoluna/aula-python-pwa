import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createWorksheet } from '../accounts-public/worksheet.js';
import { newActivity, initialAnswer } from '../dist/activity-model.js';
import { memoryAccountStore } from './helpers/account-store.mjs';
import { createAccountsServer } from '../accounts/server.mjs';
const html = await readFile(new URL('../accounts-public/index.html', import.meta.url), 'utf8');
async function waitFor(predicate, label) { const start = Date.now(); while (!predicate()) { if (Date.now() - start > 10000) throw new Error(label); await new Promise(resolve => setTimeout(resolve, 10)); } }

test('editor de ejercicios conserva archivos y respuestas al navegar; bloquea ejemplos', () => {
  const dom = new JSDOM('<div id="root"></div>'); globalThis.document = dom.window.document; globalThis.window = dom.window;
  const activity = newActivity('files'); activity.content.exercises[0].files['ejemplo.py'] = 'VALOR=42'; activity.content.exercises[0].lockedFiles = ['ejemplo.py'];
  const root = document.querySelector('#root'); let changes = 0, nextFilename = 'funciones.py'; window.prompt = () => nextFilename;
  createWorksheet(root, { activity, role: 'teacher', onChange: () => changes++ });
  const find = text => [...root.querySelectorAll('button')].find(button => button.textContent === text);
  find('Agregar archivo').click(); assert.equal(Object.hasOwn(activity.content.exercises[0].files, 'funciones.py'), true);
  find('Agregar ejercicio').click(); assert.equal(activity.content.exercises.length, 2);
  find('← Anterior').click(); assert.equal(root.querySelectorAll('.worksheet-code').length >= 1, true);
  const answer = initialAnswer(activity); const student = createWorksheet(root, { activity, answer, role: 'student', onChange: () => changes++ });
  [...root.querySelectorAll('button')].find(button => button.textContent.startsWith('ejemplo.py')).click();
  assert.equal(root.querySelector('[aria-label="Código de ejemplo.py"]').readOnly, true); assert.equal(find('Eliminar archivo').disabled, true);
  [...root.querySelectorAll('button')].find(button => button.textContent === 'main.py').click(); const code = root.querySelector('[aria-label="Código de main.py"]'); code.value = 'print(99)'; code.dispatchEvent(new dom.window.Event('input'));
  find('Siguiente →').click(); find('← Anterior').click(); assert.equal(root.querySelector('[aria-label="Código de main.py"]').value, 'print(99)');
  student.setReadonly(true); root.querySelectorAll('button').forEach(button => { button.disabled = false; }); student.syncControls(); assert.equal(find('Agregar archivo').disabled, true); assert.ok(changes >= 3); dom.window.close();
});

test('interfaz + API: profesor crea/asigna y alumno guarda/entrega; profesor revisa antes de entregar', { timeout: 60000 }, async () => {
  const nativeFetch = globalThis.fetch, store = memoryAccountStore();
  const teacher = await store.createUser({ email: 'teacher@example.com', password: 'ProfesorPrueba1234', role: 'teacher', name: 'Docente' });
  const student = await store.createUser({ email: '001@alumnos.aula.invalid', password: 'AlumnoPrueba12345', role: 'student', teacherId: teacher.id, control: '001', name: 'Ana' }); await store.updateProfile(student.id, { must_change_password: false });
  const group = await store.createGroup(teacher.id, 'Grupo A'); await store.setMembership(group.id, student.id, true);
  const server = createAccountsServer({ store }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`; let cookie;
  async function request(path, body, jar) { return nativeFetch(base + '/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: base, ...(jar ? { Cookie: jar } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  const initialLogin = await request('login', { login: 'teacher@example.com', password: 'ProfesorPrueba1234' }); cookie = initialLogin.headers.get('set-cookie').split(';')[0];
  const dom = new JSDOM(html, { url: base }); globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.location = dom.window.location; globalThis.localStorage = dom.window.localStorage; globalThis.confirm = () => true;
  globalThis.fetch = async (url, options = {}) => { const response = await nativeFetch(new URL(url, base), { ...options, headers: { ...options.headers, Origin: base, ...(cookie ? { Cookie: cookie } : {}) } }); if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0]; return response; };
  const $ = selector => document.querySelector(selector), clickText = text => [...document.querySelectorAll('button')].find(button => button.textContent === text).click();
  const idle = () => waitFor(() => !$('#logout').disabled, 'La interfaz quedó ocupada');
  const input = (selector, value) => { $(selector).value = value; $(selector).dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  try {
    await import('../accounts-public/app.js');
    $('#activities-nav').click(); await idle(); $('#new-notebook-activity').click();
    input('#activity-title', 'Primera práctica'); input('[aria-label="Contenido celda 2"]', 'print(42)'); $('#save-activity').click(); await idle();
    assert.match($('#activity-drafts').textContent, /Primera práctica/);
    document.querySelector('[name="assigned-group"]').checked = true;
    $('#assignment-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await idle(); assert.match($('#assignments-list').textContent, /Primera práctica/);
    const assignment = (await store.listAssignments(teacher.id))[0];
    $('#logout').click(); await idle(); input('#login', '001'); input('#password', 'AlumnoPrueba12345'); $('#login-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await idle();
    assert.equal($('#teacher-panel').hidden, true); assert.equal($('#activities-hub').hidden, false); clickText('Abrir actividad'); await idle();
    assert.equal(document.querySelector('[aria-label="Contenido celda 1"]'), null);
    input('[aria-label="Contenido celda 2"]', 'print(99)'); assert.match($('#answer-state').textContent, /pendientes/);
    const paste = new dom.window.Event('paste', { bubbles: true, cancelable: true }); $('[aria-label="Contenido celda 2"]').dispatchEvent(paste); assert.equal(paste.defaultPrevented, true);
    $('#save-answer').click(); await idle(); assert.match($('#answer-state').textContent, /Guardado/);
    const teacherLogin = await request('login', { login: 'teacher@example.com', password: 'ProfesorPrueba1234' }); const teacherCookie = teacherLogin.headers.get('set-cookie').split(';')[0];
    let response = await request('activity-progress', { assignmentId: assignment.id }, teacherCookie), progress = await response.json(); assert.equal(progress.students[0].submission.revision, 1); assert.equal(progress.students[0].submission.submitted_at, null);
    response = await request('activity-open', { assignmentId: assignment.id, studentId: student.id }, teacherCookie); assert.match((await response.json()).answer.cells[1].code, /99/);
    const bad = initialAnswer(assignment.snapshot); bad.cells[0].code = 'Indicaciones modificadas'; response = await request('answer-save', { assignmentId: assignment.id, revision: 1, answer: bad, submit: false }, cookie); assert.equal(response.status, 400);
    $('#submit-answer').click(); await idle(); assert.equal($('[aria-label="Contenido celda 2"]').readOnly, true); assert.equal($('#submit-answer').disabled, true); assert.match($('#answer-state').textContent, /Entregada/);
    response = await request('answer-save', { assignmentId: assignment.id, revision: 2, answer: initialAnswer(assignment.snapshot), submit: false }, cookie); assert.equal(response.status, 403);
    $('#logout').click(); await idle(); input('#login', 'teacher@example.com'); input('#password', 'ProfesorPrueba1234'); $('#login-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await idle();
    $('#activities-nav').click(); await idle(); clickText('Ver avances'); await idle(); clickText('Ver último avance'); await idle();
    assert.equal($('#review-form').hidden, false); input('#review-grade', '75.5'); input('#review-feedback', 'Corrige **la suma**.');
    $('#review-form').dispatchEvent(new dom.window.SubmitEvent('submit', { cancelable: true, submitter: $('#review-form button[value="review"]') })); await idle();
    assert.match($('#feedback-state').textContent, /75.5\/100/); assert.equal($('#reviews-list details').open, false);
    input('#review-feedback', 'Corrige y vuelve a entregar.');
    $('#review-form').dispatchEvent(new dom.window.SubmitEvent('submit', { cancelable: true, submitter: $('#review-form button[value="return"]') })); await idle();
    assert.equal($('#review-form').hidden, true); assert.match($('#feedback-state').textContent, /Devuelta/); assert.equal($('#reviews-list').children.length, 2);
    // Reutilizar el inicio de sesión real del alumno para verificar el ciclo completo.
    $('#logout').click(); await idle(); input('#login', '001'); input('#password', 'AlumnoPrueba12345'); $('#login-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await idle();
    assert.match($('#assignments-list').textContent, /Devuelta para correcciones/); clickText('Abrir actividad'); await idle();
    assert.equal($('[aria-label="Contenido celda 2"]').readOnly, false); assert.match($('#feedback-text').textContent, /Corrige y vuelve/);
    input('[aria-label="Contenido celda 2"]', 'print(100)'); $('#submit-answer').click(); await idle();
    assert.equal($('[aria-label="Contenido celda 2"]').readOnly, true); assert.match($('#feedback-state').textContent, /provisional/);
    clickText('Ver código de esta revisión'); await idle(); assert.equal($('[aria-label="Contenido celda 2"]').value, 'print(99)');
    $('#back-current-review').click(); await idle(); assert.equal($('[aria-label="Contenido celda 2"]').value, 'print(100)');
    response = await request('answer-review', { assignmentId: assignment.id, studentId: student.id, revision: 5, action: 'review', grade: 100, feedback: 'Falso' }, cookie); assert.equal(response.status, 403);
    $('#logout').click(); await idle();
  } finally { dom.window.close(); globalThis.fetch = nativeFetch; await new Promise(resolve => server.close(resolve)); }
});
