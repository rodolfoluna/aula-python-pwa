// Test double only. Not imported by the application or exposed by either server.
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { applyAnswerPatch } from '../../dist/answer-patch.js';
const copy = value => value && structuredClone(value);
export function memoryAccountStore() {
  const profiles = new Map(), identities = new Map(), groups = new Map(), memberships = new Map();
  const activities = new Map(), assignments = new Map(), submissions = new Map(), reviews = new Map();
  function passwordRecord(password) { const salt = randomBytes(16); return { salt, digest: scryptSync(password, salt, 32) }; }
  return {
    async login(email, password) { const account = identities.get(email); if (!account || !timingSafeEqual(account.digest, scryptSync(password, account.salt, 32))) throw new Error('Invalid credentials'); return account.id; },
    async profile(id) { return copy(profiles.get(id)); },
    async findStudent(control) { return copy([...profiles.values()].find(profile => profile.control === control)); },
    async listStudents(teacherId) { return [...profiles.values()].filter(profile => profile.teacher_id === teacherId).map(copy); },
    async listGroups(teacherId) { return [...groups.values()].filter(group => group.teacher_id === teacherId).map(copy); },
    async group(id) { return copy(groups.get(id)); },
    async createGroup(teacherId, name) { const group = { id: randomUUID(), teacher_id: teacherId, name }; groups.set(group.id, group); return copy(group); },
    async listMemberships(teacherId) { return [...memberships.values()].filter(row => groups.get(row.group_id).teacher_id === teacherId).map(copy); },
    async studentGroups(studentId) { return [...memberships.values()].filter(row => row.student_id === studentId).map(row => copy(groups.get(row.group_id))); },
    async setMembership(groupId, studentId, member) { const key = groupId + ':' + studentId; if (member) memberships.set(key, { group_id: groupId, student_id: studentId }); else memberships.delete(key); },
    async createUser({ email, password, role, teacherId, control, name }) {
      if (identities.has(email) || (control && [...profiles.values()].some(row => row.control === control))) throw new Error('Duplicate user');
      const id = randomUUID(), profile = { id, role, teacher_id: teacherId || null, control: control || null, name, active: true, must_change_password: role === 'student' };
      identities.set(email, { id, ...passwordRecord(password) }); profiles.set(id, profile); return copy(profile);
    },
    async setPassword(id, password) { const account = [...identities.values()].find(row => row.id === id); Object.assign(account, passwordRecord(password)); },
    async updateProfile(id, patch) { Object.assign(profiles.get(id), patch); return copy(profiles.get(id)); },
    async activity(id) { return copy(activities.get(id)); },
    async listActivities(id) { return [...activities.values()].filter(row => row.teacher_id === id).map(({ content, instructions, ...rest }) => copy(rest)); },
    async createActivity(id, data) { const value = { ...copy(data), id: randomUUID(), teacher_id: id, version: 1 }; activities.set(value.id, value); return copy(value); },
    async updateActivity(id, version, data) { const value = activities.get(id); if (!value || value.version !== version) return null; Object.assign(value, copy(data), { version: version + 1 }); return copy(value); },
    async assignment(id) { return copy(assignments.get(id)); },
    async assignmentMeta(id) { const row = assignments.get(id); if (!row) return; const { snapshot, ...rest } = row; return copy(rest); },
    async listAssignments(id) { return [...assignments.values()].filter(row => row.teacher_id === id).map(row => ({ ...copy(row), title: row.snapshot.title })); },
    async createAssignments(rows) { if (rows.some(row => [...assignments.values()].some(old => old.activity_id === row.activity_id && old.group_id === row.group_id && old.activity_version === row.activity_version))) throw Object.assign(new Error('Versión ya asignada'), { status: 409 }); return rows.map(row => { const value = { ...copy(row), id: randomUUID(), closed: false }; assignments.set(value.id, value); return copy(value); }); },
    async isMember(groupId, studentId) { return memberships.has(groupId + ':' + studentId); },
    async studentAssignments(id) { return [...assignments.values()].filter(row => memberships.has(row.group_id + ':' + id)).map(row => ({ ...copy(row), title: row.snapshot.title, submission: copy(submissions.get(row.id + ':' + id)) || null })); },
    async submission(assignmentId, studentId) { return copy(submissions.get(assignmentId + ':' + studentId)); },
    async submissionState(assignmentId, studentId) { const row = submissions.get(assignmentId + ':' + studentId); if (!row) return; const { answer, ...rest } = row; return copy(rest); },
    async progressSummary(assignmentId, teacherId, knownToken) {
      const assignment = assignments.get(assignmentId);
      if (assignment?.teacher_id !== teacherId) throw Object.assign(new Error('Actividad sin acceso'), { status: 404 });
      const students = [...profiles.values()].filter(row => row.teacher_id === teacherId && (memberships.has(assignment.group_id + ':' + row.id) || submissions.has(assignmentId + ':' + row.id))).map(student => {
        const current = submissions.get(assignmentId + ':' + student.id), { answer, last_save_id, last_save_hash, last_save_receipt, ...summary } = current || {};
        return { ...copy(student), submission: current ? copy(summary) : null };
      });
      const token = createHash('md5').update(JSON.stringify([students, assignment.closed, assignment.due_at])).digest('hex');
      if (token === knownToken) return { unchanged: true, token };
      const { snapshot, ...meta } = assignment; return { unchanged: false, token, assignment: copy(meta), students };
    },
    async saveDelta(assignmentId, studentId, revision, patch, requestId, submit) {
      const current = submissions.get(assignmentId + ':' + studentId), hash = JSON.stringify([revision, patch, submit]);
      if (current?.last_save_id === requestId) {
        if (current.last_save_hash !== hash) throw Object.assign(new Error('Identificador de otro guardado'), { status: 409 });
        return copy(current.last_save_receipt);
      }
      const base = current?.answer || null, answer = applyAnswerPatch(base, patch);
      const saved = await this.saveAnswer(assignmentId, studentId, revision, answer, submit);
      const { answer: ignored, ...receipt } = saved;
      Object.assign(submissions.get(assignmentId + ':' + studentId), { last_save_id: requestId, last_save_hash: hash, last_save_receipt: copy(receipt) });
      return copy(receipt);
    },
    async submissionSummaries(assignmentId) { return [...submissions.values()].filter(row => row.assignment_id === assignmentId).map(({ answer, ...rest }) => copy(rest)); },
    async saveAnswer(assignmentId, studentId, revision, answer, submit) {
      const key = assignmentId + ':' + studentId, current = submissions.get(key);
      if ((current?.revision || 0) !== revision) throw Object.assign(new Error('Conflicto de revisión'), { status: 409 });
      if (current?.submitted_at) throw Object.assign(new Error('Ya entregada'), { status: 403 });
      const value = { ...copy(current), last_save_id: null, last_save_hash: null, last_save_receipt: null, assignment_id: assignmentId, student_id: studentId, answer: copy(answer), revision: revision + 1, updated_at: new Date().toISOString(), submitted_at: submit ? new Date().toISOString() : null };
      submissions.set(key, value); return copy(value);
    },
    async setAssignmentClosed(id, closed) { assignments.get(id).closed = closed; return copy(assignments.get(id)); },
    async reviewSummaries(assignmentId, studentId) { return [...reviews.values()].filter(row => row.assignment_id === assignmentId && row.student_id === studentId).reverse().map(({ answer, ...rest }) => copy(rest)); },
    async review(id, assignmentId, studentId) { const row = reviews.get(id); return row?.assignment_id === assignmentId && row?.student_id === studentId ? copy(row) : null; },
    async reviewAnswer(assignmentId, studentId, teacherId, revision, action, grade, feedback, deadline) {
      const current = submissions.get(assignmentId + ':' + studentId);
      if (current.revision !== revision) throw Object.assign(new Error('Conflicto de revisión'), { status: 409 });
      const review = { id: randomUUID(), assignment_id: assignmentId, student_id: studentId, teacher_id: teacherId, submission_revision: revision, action, grade, feedback, correction_due_at: deadline, answer: copy(current.answer), submitted_at: current.submitted_at, created_at: new Date().toISOString() };
      reviews.set(review.id, review);
      Object.assign(current, { grade, feedback, reviewed_at: review.created_at, revision: revision + 1, last_save_id: null, last_save_hash: null, last_save_receipt: null });
      if (action === 'return') Object.assign(current, { submitted_at: null, returned_at: review.created_at, correction_due_at: deadline });
      return { review_id: review.id, revision: current.revision };
    },
  };
}
