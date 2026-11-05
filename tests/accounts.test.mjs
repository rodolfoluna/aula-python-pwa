import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewCsv, credentialsCsv } from '../accounts-public/csv.js';
import { createAccountsServer } from '../accounts/server.mjs';
import { createAccountsService, studentEmail } from '../accounts/service.mjs';
import { memoryAccountStore } from './helpers/account-store.mjs';

test('CSV: ceros, UTF-8, comas y comillas, duplicados, errores y separador Excel', () => {
  const rows = previewCsv('\uFEFFnumero_control,nombre\r\n00123,"Pérez, Ana"\r\n00123,Repetido\r\n00456,"José ""Pepe"" López"\r\n@@,Inválido');
  assert.equal(rows[0].control, '00123'); assert.equal(rows[0].name, 'Pérez, Ana'); assert.equal(rows[1].valid, false); assert.equal(rows[2].name, 'José "Pepe" López'); assert.equal(rows[3].valid, false);
  assert.equal(previewCsv('numero_control;nombre\n001;Ana')[0].valid, true);
  assert.equal(previewCsv('numero_control,nombre\n001,Ana', ['001'])[0].valid, false);
  assert.throws(() => previewCsv('numero_control,nombre\n"001,Ana'), /comillas/);
  assert.throws(() => previewCsv('control,nombre\n001,Ana'), /encabezados/);
  assert.match(credentialsCsv([{ control: '001', name: '=HYPERLINK("x")', password: 'temporal' }]), /"'=HYPERLINK/);
});
test('importación no regenera claves de duplicados y genera contraseñas distintas', async () => {
  const store = memoryAccountStore(), teacher = await store.createUser({ email: 'profesor@example.com', password: 'ProfesorSoloPruebas', role: 'teacher', name: 'Docente' });
  const service = createAccountsService(store), group = await service.createGroup(teacher, 'Grupo A');
  const first = await service.importStudents(teacher, [{ control: '001', name: 'Ana' }, { control: '002', name: 'Luis' }], group.id);
  assert.equal(first.created.length, 2); assert.notEqual(first.created[0].password, first.created[1].password); assert.ok(first.created[0].password.length >= 20);
  const repeated = await service.importStudents(teacher, [{ control: '001', name: 'Ana' }]); assert.equal(repeated.created.length, 0); assert.equal(repeated.rejected.length, 1);
  assert.equal(await store.login(studentEmail('001'), first.created[0].password), first.created[0].id);
  assert.equal((await store.studentGroups(first.created[0].id)).length, 0);
  await service.membership(teacher, group.id, first.created[0].id, true);
  assert.equal((await store.studentGroups(first.created[0].id)).length, 1);
});
test('API: cambio obligatorio, permisos, sesiones revocadas y separación del ejecutor', async () => {
  const store = memoryAccountStore(), teacher = await store.createUser({ email: 'profesor@example.com', password: 'ProfesorSoloPruebas', role: 'teacher', name: 'Docente' });
  const other = await store.createUser({ email: 'otro@example.com', password: 'ProfesorSoloPruebas', role: 'teacher', name: 'Otro docente' });
  const service = createAccountsService(store), group = await service.createGroup(teacher, 'Grupo A'), otherGroup = await service.createGroup(other, 'Ajeno');
  const { created } = await service.importStudents(teacher, [{ control: '0001', name: 'Ana' }], group.id);
  const student = created[0], server = createAccountsServer({ store });
  await service.membership(teacher, group.id, student.id, true);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, data, cookie, customOrigin = base) {
    const response = await fetch(base + '/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: { Origin: customOrigin, ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], fullCookie: response.headers.get('set-cookie') };
  }
  try {
    const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /Alumnos y grupos/); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    let result = await request('login', { login: '0001', password: student.password }); const pupilCookie = result.cookie;
    assert.equal(result.status, 200); assert.match(result.fullCookie, /HttpOnly/); assert.match(result.fullCookie, /SameSite=Strict/); assert.equal(result.body.access_token, undefined);
    assert.equal((await request('my-groups', undefined, pupilCookie)).status, 403);
    assert.equal((await request('roster', undefined, pupilCookie)).status, 403);
    assert.equal((await request('password', { currentPassword: 'incorrecta', password: 'OtraClaveAlumno123' }, pupilCookie)).status, 401);
    result = await request('password', { currentPassword: student.password, password: 'OtraClaveAlumno123' }, pupilCookie); const changedCookie = result.cookie;
    assert.equal(result.status, 200); assert.equal((await request('me', undefined, pupilCookie)).status, 401);
    result = await request('my-groups', undefined, changedCookie); assert.equal(result.body.groups[0].name, 'Grupo A');
    assert.equal((await request('roster', undefined, changedCookie)).status, 403);
    assert.equal((await request('answer-save', { actorId: 'another-student', assignmentId: 'one' }, changedCookie)).status, 403);
    result = await request('login', { login: 'profesor@example.com', password: 'ProfesorSoloPruebas' }); const teacherCookie = result.cookie;
    assert.equal((await request('membership', { groupId: otherGroup.id, studentId: student.id, member: true }, teacherCookie)).status, 404);
    assert.equal((await request('roster', undefined, teacherCookie, 'http://127.0.0.1:4173')).status, 403);
    result = await request('reset-password', { studentId: student.id }, teacherCookie); assert.equal(result.status, 200);
    assert.equal((await request('me', undefined, changedCookie)).status, 401);
    assert.equal((await request('login', { login: '0001', password: 'OtraClaveAlumno123' })).status, 401);
    const resetLogin = await request('login', { login: '0001', password: result.body.credential.password }); assert.equal(resetLogin.body.profile.must_change_password, true);
    await request('student-active', { studentId: student.id, active: false }, teacherCookie);
    assert.equal((await request('me', undefined, resetLogin.cookie)).status, 401);
    for (const path of ['/.env', '/accounts/server.mjs', '/python-worker.js']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await request('login', { login: '0001', password: 'no' })).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
