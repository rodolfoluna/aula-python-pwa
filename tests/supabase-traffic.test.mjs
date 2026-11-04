import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../accounts/supabase-store.mjs';

function fixture(errorCode) {
  const calls = [], groups = [{ id: 'group-a', teacher_id: 'teacher', name: 'A' }];
  let assignments = [{ id: 'assignment-a', group_id: 'group-a' }];
  const store = createSupabaseStore({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SECRET_KEY: 'test-secret', SUPABASE_PUBLISHABLE_KEY: 'test-public' }, {
    clientFactory: (url, key, options) => createClient(url, key, { ...options, global: { fetch: async (input, init) => {
      const request = new URL(input), table = request.pathname.split('/').at(-1), method = init?.method || 'GET';
      calls.push({ table, method, select: request.searchParams.get('select'), params: request.searchParams });
      if (errorCode && request.pathname.includes('/rpc/')) return new Response(JSON.stringify({ code: errorCode, message: 'Conflicto de revisión', details: null, hint: null }), { status: 409, headers: { 'content-type': 'application/json' } });
      let data;
      if (table === 'aula_groups') data = groups;
      if (table === 'aula_memberships') data = [{ group_id: 'group-a', student_id: 'student' }];
      if (table === 'aula_assignments') data = method === 'PATCH' ? { id: 'assignment-a', closed: true, due_at: null } : assignments;
      if (table === 'aula_submissions' || table === 'aula_student_deadlines') data = [];
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    } } }),
  });
  return { store, calls, groups, empty() { assignments = []; } };
}

test('la lista de integrantes reutiliza los grupos ya consultados sin otra consulta a Supabase', async () => {
  const { store, calls, groups } = fixture();
  const before = await store.listMemberships('teacher'); assert.equal(calls.length, 2);
  calls.length = 0;
  assert.deepEqual(await store.listMemberships('teacher', groups), before);
  assert.equal(calls.length, 1); assert.equal(calls[0].table, 'aula_memberships');
  calls.length = 0; assert.deepEqual(await store.listMemberships('teacher', []), []); assert.equal(calls.length, 0);
});

test('los conflictos PT409 y los códigos anteriores conservan HTTP 409 sin reintentos del SDK', async () => {
  for (const code of ['PT409', '40001']) {
    const { store, calls } = fixture(code);
    await assert.rejects(store.saveDelta('assignment', 'student', 1, { changes: [] }, 'request', false), error => error.status === 409);
    await assert.rejects(store.saveAnswer('assignment', 'student', 1, {}, false), error => error.status === 409);
    await assert.rejects(store.reviewAnswer('assignment', 'student', 'teacher', 1, 'review', 100, '', null), error => error.status === 409);
    assert.equal(calls.length, 3);
  }
});

test('cerrar una asignación solo devuelve su estado, sin descargar el proyecto', async () => {
  const { store, calls } = fixture();
  const result = await store.setAssignmentClosed('assignment-a', true);
  assert.equal(result.closed, true); assert.equal(calls.length, 1);
  assert.equal(calls[0].select, 'id,closed,due_at');
  assert.equal(result.snapshot, undefined);
});

test('el catálogo del alumno solo consulta estados de asignaciones accesibles y omite la consulta cuando no hay actividades', async () => {
  const { store, calls, empty } = fixture();
  await store.studentAssignments('student');
  const summaries = calls.find(call => call.table === 'aula_submissions');
  assert.equal(summaries.params.get('assignment_id'), 'in.(assignment-a)'); assert.ok(!summaries.select.includes('answer'));
  empty(); calls.length = 0; assert.deepEqual(await store.studentAssignments('student'), []);
  assert.equal(calls.some(call => call.table === 'aula_submissions'), false);
});
