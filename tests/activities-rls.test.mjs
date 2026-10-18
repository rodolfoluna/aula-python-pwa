import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { newActivity, initialAnswer } from '../dist/activity-model.js';

test('PostgreSQL: asignaciones, RLS, revisión atómica, plazos y entrega final', { timeout: 60000 }, async () => {
  const db = new PGlite();
  const teacher = '00000000-0000-4000-8000-000000000001', student = '00000000-0000-4000-8000-000000000002', stranger = '00000000-0000-4000-8000-000000000003';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
      create table auth.users(id uuid primary key, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to authenticated, service_role; grant execute on function auth.uid() to authenticated;`);
    for (const file of ['202610170001_accounts.sql', '202610170003_activities.sql', '202610170004_reviews.sql']) await db.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
    for (const [id, metadata] of [[teacher, { aula_role: 'teacher', aula_name: 'Docente' }], [student, { aula_role: 'student', aula_name: 'Ana', aula_control: '001', aula_teacher_id: teacher }], [stranger, { aula_role: 'student', aula_name: 'Luis', aula_control: '002', aula_teacher_id: teacher }]]) await db.query('insert into auth.users(id,raw_app_meta_data) values($1,$2)', [id, JSON.stringify(metadata)]);
    await db.exec("update aula_profiles set must_change_password = false");
    const groupId = (await db.query("insert into aula_groups(teacher_id,name) values($1,'Grupo A') returning id", [teacher])).rows[0].id;
    await db.query('insert into aula_memberships(group_id,student_id) values($1,$2)', [groupId, student]);
    const template = newActivity(), answer = initialAnswer(template);
    const activityId = (await db.query("insert into aula_activities(teacher_id,title,kind,content) values($1,$2,'notebook',$3) returning id", [teacher, template.title, JSON.stringify(template.content)])).rows[0].id;
    const assignmentId = (await db.query('insert into aula_assignments(activity_id,teacher_id,group_id,activity_version,snapshot) values($1,$2,$3,1,$4) returning id', [activityId, teacher, groupId, JSON.stringify(template)])).rows[0].id;
    async function asUser(id, sql) { await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated'); try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); } }
    assert.equal((await asUser(student, 'select * from aula_assignments')).length, 1); assert.equal((await asUser(stranger, 'select * from aula_assignments')).length, 0);
    assert.equal((await asUser(student, 'select * from aula_activities')).length, 0);
    await assert.rejects(asUser(student, 'delete from aula_submissions'));
    assert.equal((await db.query("select has_function_privilege('authenticated','aula_save_answer(uuid,uuid,integer,jsonb,boolean)','execute') as allowed")).rows[0].allowed, false);
    async function save(id, revision, submit = false) { return db.query("select (receipt->>'revision')::integer as revision, (receipt->>'submitted_at')::timestamptz as submitted_at, receipt ? 'answer' as includes_answer from (select aula_save_answer($1,$2,$3,$4,$5) as receipt) as saved", [assignmentId, id, revision, JSON.stringify(answer), submit]); }
    const firstSave = (await save(student, 0)).rows[0]; assert.equal(firstSave.revision, 1); assert.equal(firstSave.includes_answer, false);
    await assert.rejects(save(student, 0), /otra sesión/); await assert.rejects(save(stranger, 0), /acceso/);
    assert.equal((await asUser(teacher, 'select * from aula_submissions')).length, 1); assert.equal((await asUser(stranger, 'select * from aula_submissions')).length, 0);
    await db.query('update aula_assignments set closed = true where id = $1', [assignmentId]); await assert.rejects(save(student, 1), /cerrada/);
    await db.query("update aula_assignments set closed = false, due_at = now() - interval '1 second' where id = $1", [assignmentId]); await assert.rejects(save(student, 1), /vencida/);
    await db.query('update aula_assignments set due_at = null where id = $1', [assignmentId]);
    assert.ok((await save(student, 1, true)).rows[0].submitted_at); await assert.rejects(save(student, 2), /entregada/);
    await assert.rejects(db.query("update aula_assignments set snapshot = '{}' where id = $1", [assignmentId]), /publicada/);
    async function review(revision, action = 'review', grade = 80, feedback = 'Corrige la suma.', deadline = new Date(Date.now() + 86400000).toISOString(), actor = teacher) {
      return db.query('select aula_review_answer($1,$2,$3,$4,$5,$6,$7,$8) as receipt', [assignmentId, student, actor, revision, action, grade, feedback, deadline]);
    }
    await assert.rejects(review(2, 'review', 101), /inválidos/);
    await assert.rejects(review(2, 'review', 80, '', null, stranger), /acceso/);
    assert.equal((await db.query("select has_function_privilege('authenticated','aula_review_answer(uuid,uuid,uuid,integer,text,numeric,text,timestamptz)','execute') as allowed")).rows[0].allowed, false);
    await db.exec('set role service_role'); await review(2); await db.exec('reset role');
    await assert.rejects(review(2), /cambió/);
    assert.equal((await asUser(student, 'select * from aula_reviews')).length, 1);
    assert.equal((await asUser(stranger, 'select * from aula_reviews')).length, 0);
    await assert.rejects(asUser(student, 'delete from aula_reviews'));
    await assert.rejects(asUser(teacher, 'update aula_submissions set grade = 100'));
    await db.query("update aula_assignments set due_at = now() - interval '1 day' where id = $1", [assignmentId]);
    await review(3, 'return', null);
    await assert.rejects(save(student, 3), /otra sesión/);
    const revised = (await save(student, 4, true)).rows[0]; assert.equal(revised.revision, 5);
    await assert.rejects(save(student, 5), /entregada/);
    await review(5, 'return', 90);
    await db.query("update aula_submissions set correction_due_at = now() - interval '1 second' where assignment_id = $1", [assignmentId]);
    await assert.rejects(save(student, 6), /vencida/);
    await db.query('insert into aula_memberships(group_id,student_id) values($1,$2)', [groupId, stranger]);
    await assert.rejects(save(stranger, 0), /vencida/); // La prórroga no se extiende al resto del grupo.
    const history = (await db.query('select * from aula_reviews order by created_at')).rows;
    assert.equal(history.length, 3); assert.deepEqual(history[0].answer, answer); assert.equal(Number(history[0].grade), 80); assert.ok(history[0].submitted_at);
    await db.query('delete from aula_memberships where student_id = $1', [student]);
    assert.equal((await asUser(student, 'select * from aula_reviews')).length, 0);
  } finally { await db.close(); }
});
