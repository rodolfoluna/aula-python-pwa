import { createClient } from '@supabase/supabase-js';

export function createSupabaseStore(env = process.env, { clientFactory = createClient } = {}) {
  const url = env.SUPABASE_URL, secret = env.SUPABASE_SECRET_KEY, publishable = env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !secret || !publishable || /REEMPLAZAR|TU_PROYECTO/.test(url + secret + publishable)) throw new Error('Configura SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY y SUPABASE_SECRET_KEY en .env.');
  if (new URL(url).protocol !== 'https:') throw new Error('La URL de Supabase debe usar HTTPS.');
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = clientFactory(url, secret, options);
  const result = ({ data, error }) => { if (error) throw Object.assign(new Error(error.message), { code: error.code }); return data; };
  const profile = async id => result(await admin.from('aula_profiles').select('*').eq('id', id).maybeSingle());
  async function ensureProfile(user) {
    const existing = await profile(user.id);
    if (existing) return existing;
    const metadata = user.app_metadata || {}, role = metadata.aula_role, name = metadata.aula_name;
    if (!['teacher', 'student'].includes(role) || typeof name !== 'string' || !name.trim() || name.trim().length > 160) throw new Error('La cuenta no tiene metadatos administrativos válidos para crear su perfil.');
    const teacherId = role === 'student' ? metadata.aula_teacher_id : null;
    const control = role === 'student' ? metadata.aula_control : null;
    if (role === 'student') {
      const owner = teacherId && await profile(teacherId);
      if (!owner?.active || owner.role !== 'teacher' || typeof control !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(control)) throw new Error('Faltan los datos del profesor o del alumno para crear su perfil.');
    }
    // Respaldo para instalaciones con el disparador anterior. Solo inserta:
    // jamás cambia un perfil, rol, contraseña o estado ya existentes.
    result(await admin.from('aula_profiles').upsert({ id: user.id, role, teacher_id: teacherId, control, name: name.trim(), active: true, must_change_password: role === 'student' }, { onConflict: 'id', ignoreDuplicates: true }));
    const created = await profile(user.id);
    if (!created) throw new Error('No se pudo completar el perfil. Revisa la migración SQL de Aula Python.');
    return created;
  }
  return {
    async login(email, password) {
      // Un cliente distinto por inicio evita mezclar sesiones entre alumnos.
      const client = clientFactory(url, publishable, options);
      const data = result(await client.auth.signInWithPassword({ email, password }));
      return data.user?.id;
    },
    profile,
    async findStudent(control) { return result(await admin.from('aula_profiles').select('*').eq('control', control).maybeSingle()); },
    async listStudents(teacherId) { return result(await admin.from('aula_profiles').select('*').eq('teacher_id', teacherId).eq('role', 'student').order('name')); },
    async listGroups(teacherId) { return result(await admin.from('aula_groups').select('*').eq('teacher_id', teacherId).order('name')); },
    async group(id) { return result(await admin.from('aula_groups').select('*').eq('id', id).maybeSingle()); },
    async createGroup(teacherId, name) { return result(await admin.from('aula_groups').insert({ teacher_id: teacherId, name }).select().single()); },
    async listMemberships(teacherId, knownGroups) {
      const groups = knownGroups || await this.listGroups(teacherId);
      return groups.length ? result(await admin.from('aula_memberships').select('*').in('group_id', groups.map(group => group.id))) : [];
    },
    async studentGroups(studentId) { return result(await admin.from('aula_memberships').select('aula_groups(id,name)').eq('student_id', studentId)).map(row => row.aula_groups); },
    async setMembership(groupId, studentId, member) {
      if (member) result(await admin.from('aula_memberships').upsert({ group_id: groupId, student_id: studentId }));
      else result(await admin.from('aula_memberships').delete().eq('group_id', groupId).eq('student_id', studentId));
    },
    async createUser({ email, password, role, teacherId, control, name }) {
      const data = result(await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { aula_role: role, aula_teacher_id: teacherId, aula_control: control, aula_name: name } }));
      return ensureProfile(data.user);
    },
    async repairTeacherProfiles({ dryRun = false } = {}) {
      let missing = 0, repaired = 0;
      for (let page = 1; ; page++) {
        const { users } = result(await admin.auth.admin.listUsers({ page, perPage: 100 }));
        for (const user of users) {
          if (user.app_metadata?.aula_role !== 'teacher' || await profile(user.id)) continue;
          missing++;
          if (!dryRun) { await ensureProfile(user); repaired++; }
        }
        if (users.length < 100) break;
      }
      return { missing, repaired };
    },
    async setPassword(id, password) { result(await admin.auth.admin.updateUserById(id, { password })); },
    async updateProfile(id, patch) { return result(await admin.from('aula_profiles').update(patch).eq('id', id).select().single()); },
    async activity(id) { return result(await admin.from('aula_activities').select('*').eq('id', id).maybeSingle()); },
    async listActivities(teacherId) { return result(await admin.from('aula_activities').select('id,title,kind,version,updated_at').eq('teacher_id', teacherId).order('updated_at', { ascending: false })); },
    async createActivity(teacherId, activity) { return result(await admin.from('aula_activities').insert({ ...activity, teacher_id: teacherId }).select().single()); },
    async updateActivity(id, version, activity) { return result(await admin.from('aula_activities').update({ ...activity, version: version + 1, updated_at: new Date().toISOString() }).eq('id', id).eq('version', version).select().maybeSingle()); },
    async assignment(id) { return result(await admin.from('aula_assignments').select('*').eq('id', id).maybeSingle()); },
    async assignmentMeta(id) { return result(await admin.from('aula_assignments').select('id,activity_id,teacher_id,group_id,activity_version,due_at,closed,created_at').eq('id', id).maybeSingle()); },
    async listAssignments(teacherId) { return result(await admin.from('aula_assignments').select('id,activity_id,group_id,activity_version,closed,due_at,created_at,title:snapshot->>title,group:aula_groups(name)').eq('teacher_id', teacherId).order('created_at', { ascending: false })); },
    async createAssignments(rows) {
      const { data, error } = await admin.from('aula_assignments').insert(rows).select('id,group_id,activity_version');
      if (error?.code === '23505') throw Object.assign(new Error('Esta versión ya está asignada a uno de los grupos seleccionados.'), { status: 409 });
      return result({ data, error });
    },
    async isMember(groupId, studentId) { return !!result(await admin.from('aula_memberships').select('student_id').eq('group_id', groupId).eq('student_id', studentId).maybeSingle()); },
    async studentAssignments(studentId) {
      const memberships = result(await admin.from('aula_memberships').select('group_id').eq('student_id', studentId));
      if (!memberships.length) return [];
      const assignments = result(await admin.from('aula_assignments').select('id,group_id,activity_version,closed,due_at,created_at,title:snapshot->>title,group:aula_groups(name)').in('group_id', memberships.map(row => row.group_id)).order('created_at', { ascending: false }));
      if (!assignments.length) return [];
      const submissions = result(await admin.from('aula_submissions').select('assignment_id,revision,updated_at,submitted_at,grade,reviewed_at,returned_at,correction_due_at').eq('student_id', studentId).in('assignment_id', assignments.map(row => row.id)));
      return assignments.map(assignment => ({ ...assignment, submission: submissions.find(row => row.assignment_id === assignment.id) || null }));
    },
    async submission(assignmentId, studentId) { return result(await admin.from('aula_submissions').select('*').eq('assignment_id', assignmentId).eq('student_id', studentId).maybeSingle()); },
    async submissionState(assignmentId, studentId) { return result(await admin.from('aula_submissions').select('revision,submitted_at,returned_at,correction_due_at,last_save_id,last_save_receipt').eq('assignment_id', assignmentId).eq('student_id', studentId).maybeSingle()); },
    async progressSummary(assignmentId, teacherId, token) {
      const { data, error } = await admin.rpc('aula_progress_summary', { assignment_key: assignmentId, teacher_key: teacherId, known_token: token });
      if (error) throw Object.assign(new Error(error.message), { code: error.code, status: error.code === '42501' ? 404 : 500 }); return data;
    },
    async saveDelta(assignmentId, studentId, revision, patch, requestId, submit) {
      const { data, error } = await admin.rpc('aula_patch_answer', { assignment_key: assignmentId, student_key: studentId, expected_revision: revision, answer_patch: patch, request_key: requestId, final_submit: submit });
      if (error) throw Object.assign(new Error(error.message), { code: error.code, status: error.code === '40001' ? 409 : error.code === '42501' ? 403 : error.code === '22023' ? 400 : 500 }); return data;
    },
    async submissionSummaries(assignmentId) { return result(await admin.from('aula_submissions').select('student_id,revision,updated_at,submitted_at,grade,reviewed_at,returned_at,correction_due_at').eq('assignment_id', assignmentId)); },
    async reviewSummaries(assignmentId, studentId) { return result(await admin.from('aula_reviews').select('id,action,grade,feedback,created_at,submitted_at,correction_due_at,submission_revision').eq('assignment_id', assignmentId).eq('student_id', studentId).order('created_at', { ascending: false })); },
    async review(id, assignmentId, studentId) { return result(await admin.from('aula_reviews').select('*').eq('id', id).eq('assignment_id', assignmentId).eq('student_id', studentId).maybeSingle()); },
    async reviewAnswer(assignmentId, studentId, teacherId, revision, action, grade, feedback, deadline) {
      const { data, error } = await admin.rpc('aula_review_answer', { assignment_key: assignmentId, student_key: studentId, teacher_key: teacherId, expected_revision: revision, review_action: action, grade_value: grade, feedback_value: feedback, correction_deadline: deadline });
      if (error) throw Object.assign(new Error(error.message), { code: error.code, status: error.code === '40001' ? 409 : error.code === '42501' ? 403 : error.code === '22023' ? 400 : 500 });
      return data;
    },
    async saveAnswer(assignmentId, studentId, revision, answer, submit) {
      const { data, error } = await admin.rpc('aula_save_answer', { assignment_key: assignmentId, student_key: studentId, expected_revision: revision, answer_value: answer, final_submit: submit });
      if (error) throw Object.assign(new Error(error.message), { status: error.code === '40001' ? 409 : error.code === '42501' ? 403 : 500 });
      return Array.isArray(data) ? data[0] : data;
    },
    async deleteAssignment(id, teacherId) { result(await admin.from('aula_assignments').delete().eq('id', id).eq('teacher_id', teacherId)); },
    async setAssignmentDeadline(id, teacherId, previousDueAt, dueAt) {
      const query = admin.from('aula_assignments').update({ due_at: dueAt }).eq('id', id).eq('teacher_id', teacherId);
      return result(await (previousDueAt ? query.eq('due_at', previousDueAt) : query.is('due_at', null)).select('id,due_at,closed').maybeSingle());
    },
    async setAssignmentClosed(id, closed) { return result(await admin.from('aula_assignments').update({ closed }).eq('id', id).select('id,closed,due_at').single()); },
    async health() {
      for (const table of ['aula_profiles', 'aula_groups', 'aula_memberships']) result(await admin.from(table).select('*').limit(1));
    },
    async healthActivities() {
      for (const table of ['aula_activities', 'aula_assignments', 'aula_submissions']) result(await admin.from(table).select(table === 'aula_submissions' ? 'assignment_id' : 'id').limit(1));
      result(await admin.from('aula_submissions').select('grade,feedback,returned_at,correction_due_at,reviewed_at,last_save_id,last_save_receipt').limit(1));
      result(await admin.from('aula_reviews').select('id').limit(1));
    },
  };
}
