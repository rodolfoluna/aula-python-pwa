import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL real: aprovisionamiento atómico y RLS por profesor y alumno', { timeout: 60000 }, async () => {
  const db = new PGlite();
  const ids = { teacher: '00000000-0000-4000-8000-000000000001', other: '00000000-0000-4000-8000-000000000002', student: '00000000-0000-4000-8000-000000000003', stranger: '00000000-0000-4000-8000-000000000004' };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
      create table auth.users(id uuid primary key, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to authenticated, service_role; grant execute on function auth.uid() to authenticated;`);
    await db.exec(await readFile(new URL('../supabase/migrations/202610170001_accounts.sql', import.meta.url), 'utf8'));
    async function user(id, metadata, userMetadata = {}) { await db.query('insert into auth.users values ($1, $2, $3)', [id, JSON.stringify(metadata), JSON.stringify(userMetadata)]); }
    await user(ids.teacher, { aula_role: 'teacher', aula_name: 'Docente' });
    // Auth inserta primero y actualiza app_metadata después, en la misma transacción.
    await db.exec('begin');
    await user('00000000-0000-4000-8000-000000000010', { provider: 'email' });
    await db.query('update auth.users set raw_app_meta_data = $1 where id = $2', [JSON.stringify({ aula_role: 'teacher', aula_name: 'Creación en dos fases' }), '00000000-0000-4000-8000-000000000010']);
    await db.exec('commit');
    assert.equal((await db.query("select role from aula_profiles where id = '00000000-0000-4000-8000-000000000010'")).rows[0].role, 'teacher');
    await db.query("delete from auth.users where id = '00000000-0000-4000-8000-000000000010'");
    await user(ids.other, { aula_role: 'teacher', aula_name: 'Otro docente' });
    await user(ids.student, { aula_role: 'student', aula_name: 'Ana', aula_control: '001', aula_teacher_id: ids.teacher });
    await user(ids.stranger, {}, { aula_role: 'teacher', aula_name: 'Rol inventado' });
    assert.equal((await db.query('select count(*)::int as total from aula_profiles')).rows[0].total, 3);
    await assert.rejects(user('00000000-0000-4000-8000-000000000005', { aula_role: 'student', aula_name: 'Duplicado', aula_control: '001', aula_teacher_id: ids.teacher }));
    assert.equal((await db.query('select count(*)::int as total from auth.users')).rows[0].total, 4);
    const group = (await db.query('insert into aula_groups(teacher_id,name) values ($1, $2) returning id', [ids.teacher, 'Grupo A'])).rows[0].id;
    const foreignGroup = (await db.query('insert into aula_groups(teacher_id,name) values ($1, $2) returning id', [ids.other, 'Grupo ajeno'])).rows[0].id;
    await db.query('insert into aula_memberships(group_id,student_id) values ($1,$2)', [group, ids.student]);
    await assert.rejects(db.query('insert into aula_memberships(group_id,student_id) values ($1,$2)', [foreignGroup, ids.student]));
    async function asUser(id, query) { await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]); await db.exec('set role authenticated'); try { return (await db.query(query)).rows; } finally { await db.exec('reset role'); } }
    assert.equal((await asUser(ids.student, 'select * from aula_groups')).length, 0);
    assert.equal((await asUser(ids.student, 'select * from aula_profiles')).length, 1);
    await assert.rejects(asUser(ids.student, "update aula_profiles set role = 'teacher'"));
    await db.query('update aula_profiles set must_change_password = false where id = $1', [ids.student]);
    assert.equal((await asUser(ids.student, 'select * from aula_groups')).length, 1);
    assert.equal((await asUser(ids.teacher, 'select * from aula_profiles')).length, 2);
    assert.equal((await asUser(ids.other, 'select * from aula_memberships')).length, 0);
    assert.equal((await asUser(ids.stranger, 'select * from aula_profiles')).length, 0);
    await db.query('update aula_profiles set active = false where id = $1', [ids.student]);
    await db.query('update auth.users set raw_app_meta_data = raw_app_meta_data || $1 where id = $2', [JSON.stringify({ provider: 'email' }), ids.student]);
    assert.equal((await db.query('select active, must_change_password from aula_profiles where id = $1', [ids.student])).rows[0].active, false);
    assert.equal((await asUser(ids.student, 'select * from aula_groups')).length, 0);
    // La reparación adicional puede aplicarse varias veces sin cambiar perfiles.
    const repair = await readFile(new URL('../supabase/migrations/202610170002_profile_trigger_fix.sql', import.meta.url), 'utf8');
    await db.exec('drop trigger aula_new_auth_user on auth.users');
    await user('00000000-0000-4000-8000-000000000011', { aula_role: 'teacher', aula_name: 'Profesor pendiente' });
    await db.exec(repair); await db.exec(repair);
    assert.equal((await db.query("select count(*)::int as total from aula_profiles where id = '00000000-0000-4000-8000-000000000011'")).rows[0].total, 1);
    assert.equal((await db.query('select active from aula_profiles where id = $1', [ids.student])).rows[0].active, false);
  } finally { await db.close(); }
});
