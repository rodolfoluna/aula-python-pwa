import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseStore } from '../accounts/supabase-store.mjs';
function setup(users = [], initialProfiles = []) {
  const profiles = new Map(initialProfiles.map(profile => [profile.id, { ...profile }]));
  const inserted = [];
  const admin = {
    auth: { admin: {
      async createUser({ email, app_metadata }) { const user = { id: 'new-user', email, app_metadata }; users.push(user); return { data: { user }, error: null }; },
      async listUsers() { return { data: { users }, error: null }; },
    } },
    from(table) {
      assert.equal(table, 'aula_profiles'); let id;
      return {
        select() { return this; }, eq(key, value) { assert.equal(key, 'id'); id = value; return this; },
        async maybeSingle() { return { data: profiles.get(id) || null, error: null }; },
        async upsert(value, options) { assert.equal(options.ignoreDuplicates, true); inserted.push(value); if (!profiles.has(value.id)) profiles.set(value.id, { ...value }); return { data: null, error: null }; },
      };
    },
  };
  const store = createSupabaseStore({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }, { clientFactory: () => admin });
  return { store, inserted, profiles };
}
test('SDK: completa perfiles con app_metadata administrativo cuando el trigger antiguo no lo hizo', async () => {
  const { store, inserted } = setup();
  const teacher = await store.createUser({ email: 'docente@example.com', password: 'SoloParaEstaPrueba123', role: 'teacher', name: 'Docente' });
  assert.equal(teacher.role, 'teacher'); assert.equal(teacher.must_change_password, false); assert.equal(inserted.length, 1);
  assert.equal(inserted[0].password, undefined);
});
test('reparación idempotente no utiliza user_metadata ni reactiva perfiles existentes', async () => {
  const users = [
    { id: 'pending', app_metadata: { aula_role: 'teacher', aula_name: 'Pendiente' } },
    { id: 'forged', user_metadata: { aula_role: 'teacher', aula_name: 'Falso' } },
    { id: 'existing', app_metadata: { aula_role: 'teacher', aula_name: 'Existente' } },
  ];
  const { store, profiles, inserted } = setup(users, [{ id: 'existing', role: 'teacher', name: 'Existente', active: false }]);
  assert.deepEqual(await store.repairTeacherProfiles({ dryRun: true }), { missing: 1, repaired: 0 }); assert.equal(inserted.length, 0);
  assert.deepEqual(await store.repairTeacherProfiles(), { missing: 1, repaired: 1 });
  assert.deepEqual(await store.repairTeacherProfiles(), { missing: 0, repaired: 0 });
  assert.equal(profiles.get('existing').active, false); assert.equal(profiles.has('forged'), false);
});
