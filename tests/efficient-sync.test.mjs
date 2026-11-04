import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerPatch, applyAnswerPatch } from '../dist/answer-patch.js';
import { DraftSync } from '../accounts-public/draft-sync.js';
import { PollBudget } from '../accounts-public/sync-policy.js';
import { BoundedCache } from '../accounts/bounded-cache.mjs';
import { memoryAccountStore } from './helpers/account-store.mjs';
import { createActivitiesService } from '../accounts/activities.mjs';
import { newActivity } from '../dist/activity-model.js';

test('diferencias: celdas, archivos, cambios de estructura y ahorro medido', () => {
  const before = { cells: Array.from({ length: 100 }, (_, i) => ({ id: String(i), code: 'x'.repeat(1000) })) }, after = structuredClone(before);
  after.cells[7].code = 'print(42)'; const patch = answerPatch(before, after);
  assert.deepEqual(applyAnswerPatch(before, patch), after); assert.equal(patch.changes.length, 1);
  assert.ok(JSON.stringify(patch).length < JSON.stringify(after).length / 100);
  after.cells.reverse(); assert.deepEqual(applyAnswerPatch(before, answerPatch(before, after)), after);
  const files = { exercises: [{ id: 'one', entry: 'main.py', files: { 'main.py': 'old', 'remove.py': 'x' } }] }, changed = structuredClone(files);
  delete changed.exercises[0].files['remove.py']; changed.exercises[0].files['added.py'] = 'new'; changed.exercises[0].entry = 'added.py';
  assert.deepEqual(applyAnswerPatch(files, answerPatch(files, changed)), changed);
  assert.throws(() => applyAnswerPatch({}, { changes: [{ path: ['__proto__','polluted'], value: true }] }), /inválida/);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(answerPatch({ a: 1, b: 2 }, { b: 2, a: 1 }).changes, []);
});

test('servidor reutiliza solo contenido confirmado; comprueba permisos y revisiones en cada delta', async () => {
  const store = memoryAccountStore(), teacher = await store.createUser({ email: 'efficient@example.com', password: 'PruebaTemporal123', role: 'teacher', name: 'Docente' });
  const pupil = await store.createUser({ email: 'pupil@example.com', password: 'PruebaTemporal123', role: 'student', teacherId: teacher.id, control: '003', name: 'Ana' });
  await store.updateProfile(pupil.id, { must_change_password: false });
  const group = await store.createGroup(teacher.id, 'A'); await store.setMembership(group.id, pupil.id, true);
  const service = createActivitiesService(store), activity = await service.saveActivity(teacher, newActivity());
  const [assignment] = await service.assign(teacher, { activityId: activity.id, version: 1, groupIds: [group.id] });
  const opened = await service.open(pupil, assignment.id), changed = structuredClone(opened.answer); changed.cells[1].code = 'print(1)';
  let answerReads = 0, snapshotReads = 0;
  const readAnswer = store.submission.bind(store), readAssignment = store.assignment.bind(store);
  store.submission = async (...args) => { answerReads++; return readAnswer(...args); }; store.assignment = async (...args) => { snapshotReads++; return readAssignment(...args); };
  const payload = { assignmentId: assignment.id, revision: 0, patch: { changes: [{ path: [], value: changed }] }, requestId: crypto.randomUUID(), submit: false };
  await service.saveAnswer(pupil, payload); assert.equal(answerReads, 0); assert.equal(snapshotReads, 0);
  const next = structuredClone(changed); next.cells[1].code = 'print(2)';
  await service.saveAnswer(pupil, { ...payload, revision: 1, requestId: crypto.randomUUID(), patch: answerPatch(changed, next) }); assert.equal(answerReads, 0);
  const progress = await service.progress(teacher, assignment.id); assert.equal((await service.progress(teacher, assignment.id, progress.token)).unchanged, true);
  assert.equal(progress.students[0].submission.answer, undefined); assert.equal((await store.listActivities(teacher.id))[0].content, undefined);
  await assert.rejects(service.saveAnswer(pupil, { ...payload, revision: 2, requestId: crypto.randomUUID(), patch: { changes: [{ path: ['extra'], value: 'no permitido' }] } }), /no permitidos/);
  await assert.rejects(service.saveAnswer(pupil, { ...payload, revision: 2, requestId: crypto.randomUUID(), patch: { changes: [{ path: ['cells','0','code'], value: 'Cambiar indicaciones' }] } }), /bloqueada/);
  const restarted = createActivitiesService(store);
  const final = structuredClone(next); final.cells[1].code = 'print(3)';
  await restarted.saveAnswer(pupil, { ...payload, revision: 2, requestId: crypto.randomUUID(), patch: answerPatch(next, final) }); assert.equal(answerReads, 1);
  const current = await service.open(pupil, assignment.id); assert.equal(current.submission.answer, undefined); assert.equal(current.answer.cells[1].code, 'print(3)');
  await store.setMembership(group.id, pupil.id, false);
  await assert.rejects(service.saveAnswer(pupil, { ...payload, revision: 3 }), /sin acceso/);
});

test('guardado diferencial: no escribe cambios revertidos, reintenta el mismo acuse y conserva ediciones nuevas', async () => {
  const memory = new Map(), storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  let calls = [], loseResponse = true, stored = { value: 0 }, revision = 1, lastId;
  const save = async payload => {
    calls.push(structuredClone(payload));
    if (payload.requestId !== lastId) { assert.equal(payload.revision, revision); stored = applyAnswerPatch(stored, payload.patch); revision++; lastId = payload.requestId; }
    if (loseResponse) { loseResponse = false; throw new Error('Conexión perdida después del guardado'); }
    return { revision, submitted_at: payload.submit ? '2026-10-17' : null };
  };
  const sync = new DraftSync({ key: 'draft', answer: stored, revision, delta: true, storage, save });
  sync.set({ value: 1 }); sync.set({ value: 0 }); await sync.flush(); assert.equal(calls.length, 0);
  sync.set({ value: 1 }); await assert.rejects(sync.flush(), /perdida/); assert.equal(revision, 2);
  sync.set({ value: 2 }); await sync.flush(); assert.equal(calls[0].requestId, calls[1].requestId); assert.equal(revision, 2); assert.equal(sync.dirty, true);
  await sync.flush(); assert.equal(stored.value, 2); assert.equal(revision, 3); assert.equal(sync.dirty, false);
  sync.set({ value: 3 }); loseResponse = true; await assert.rejects(sync.flush());
  sync.set({ value: 4 });
  const recovered = new DraftSync({ key: 'draft', answer: stored, revision, delta: true, lastSaveId: lastId, storage, save });
  assert.equal(recovered.conflict, false); assert.equal(recovered.answer.value, 4); await recovered.flush(true); assert.equal(stored.value, 4); assert.equal(recovered.submitted, true);
});

test('seguimiento y caché: limita consultas en reposo, retrocede en fallos y acota memoria', () => {
  let now = 0; const budget = new PollBudget(() => now);
  budget.completed(false); assert.equal(budget.nextAt, 30000); now = 30000; assert.equal(budget.due(), true);
  budget.completed(true); assert.equal(budget.delay, 60000); budget.completed(true); assert.equal(budget.delay, 120000);
  budget.completed(true); assert.equal(budget.delay, 120000); budget.completed(false); assert.equal(budget.delay, 30000);
  budget.completed(false, true); assert.equal(budget.delay, 60000);
  const cache = new BoundedCache({ bytes: 30, ttl: 10, clock: () => now });
  cache.set('one', { value: '1234567890' }); cache.set('two', { value: '1234567890' }); assert.equal(cache.get('one'), undefined);
  const copy = cache.get('two'); copy.value = 'changed'; assert.equal(cache.get('two').value, '1234567890'); now += 11; assert.equal(cache.get('two'), undefined);
});

test('abrir como alumno no relee su perfil y revisar/cerrar no descargan código para comprobar el estado', async () => {
  const store = memoryAccountStore(), teacher = await store.createUser({ email: 'traffic@example.com', password: 'PruebaTemporal123', role: 'teacher', name: 'Docente' });
  let pupil = await store.createUser({ email: 'traffic-pupil@example.com', password: 'PruebaTemporal123', role: 'student', teacherId: teacher.id, control: '010', name: 'Ana' });
  pupil = await store.updateProfile(pupil.id, { must_change_password: false });
  const group = await store.createGroup(teacher.id, 'A'); await store.setMembership(group.id, pupil.id, true);
  const service = createActivitiesService(store), activity = await service.saveActivity(teacher, newActivity());
  const [assignment] = await service.assign(teacher, { activityId: activity.id, version: 1, groupIds: [group.id] });
  let profiles = 0, snapshots = 0, answers = 0;
  for (const [method, counted] of [['profile', () => profiles++], ['assignment', () => snapshots++], ['submission', () => answers++]]) {
    const original = store[method].bind(store); store[method] = (...args) => { counted(); return original(...args); };
  }
  const opened = await service.open(pupil, assignment.id); assert.equal(profiles, 0);
  await service.saveAnswer(pupil, { assignmentId: assignment.id, revision: 0, answer: opened.answer, submit: true });
  snapshots = answers = 0;
  await service.review(teacher, { assignmentId: assignment.id, studentId: pupil.id, revision: 1, action: 'review', grade: 100, feedback: 'Bien' });
  assert.equal(answers, 0);
  // A fresh service has no template cache, so closing must still need no snapshot.
  await createActivitiesService(store).close(teacher, { assignmentId: assignment.id, closed: true });
  assert.equal(snapshots, 0); assert.equal((await store.assignmentMeta(assignment.id)).closed, true);
});
