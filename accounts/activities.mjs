import { AccountError } from './service.mjs';
import { normalizeActivity, validateAnswer, initialAnswer } from '../dist/activity-model.js';
import { applyAnswerPatch, sameAnswer } from '../dist/answer-patch.js';
import { BoundedCache } from './bounded-cache.mjs';
export function createActivitiesService(store, clock = () => Date.now()) {
  const templates = new BoundedCache({ bytes: 4194304, clock }), answers = new BoundedCache({ bytes: 33554432, clock });
  const denied = () => new AccountError(404, 'Actividad no encontrada o sin acceso.');
  async function owned(profile, id) { const activity = await store.activity(id); if (!activity || activity.teacher_id !== profile.id || profile.role !== 'teacher') throw denied(); return activity; }
  async function assigned(profile, id, withSnapshot = true) {
    const assignment = await store.assignmentMeta(id); if (!assignment) throw denied();
    if (profile.role === 'teacher') { if (assignment.teacher_id !== profile.id) throw denied(); }
    else if (!await store.isMember(assignment.group_id, profile.id)) throw denied();
    if (withSnapshot) {
      let snapshot = templates.get(id);
      if (!snapshot) { snapshot = (await store.assignment(id))?.snapshot; if (!snapshot) throw denied(); templates.set(id, snapshot); }
      assignment.snapshot = snapshot;
    }
    return assignment;
  }
  const writable = (assignment, submission) => {
    const deadline = submission?.returned_at ? submission.correction_due_at : assignment.due_at;
    return !submission?.submitted_at && !assignment.closed && (!deadline || Date.parse(deadline) > clock());
  };
  return {
    async template(profile, id) { return owned(profile, id); },
    async list(profile) {
      if (profile.role === 'teacher') return { activities: await store.listActivities(profile.id), assignments: await store.listAssignments(profile.id) };
      return { assignments: await store.studentAssignments(profile.id) };
    },
    async saveActivity(profile, data) {
      if (profile.role !== 'teacher') throw new AccountError(403, 'Solo el profesor puede crear actividades.');
      let activity; try { activity = normalizeActivity(data); } catch (error) { throw new AccountError(400, error.message); }
      if (!data.id) return store.createActivity(profile.id, activity);
      await owned(profile, data.id);
      if (!Number.isInteger(data.version) || data.version < 1) throw new AccountError(400, 'Versión de actividad inválida.');
      const updated = await store.updateActivity(data.id, data.version, activity);
      if (!updated) throw new AccountError(409, 'La actividad cambió en otra sesión. Ábrela de nuevo antes de guardar.');
      return updated;
    },
    async assign(profile, data) {
      const activity = await owned(profile, data.activityId);
      if (data.version !== activity.version) throw new AccountError(409, 'Guarda y vuelve a abrir la actividad antes de asignarla.');
      if (!Array.isArray(data.groupIds) || !data.groupIds.length || data.groupIds.length > 100 || new Set(data.groupIds).size !== data.groupIds.length) throw new AccountError(400, 'Selecciona al menos un grupo, sin duplicados.');
      for (const id of data.groupIds) { const group = await store.group(id); if (!group || group.teacher_id !== profile.id) throw denied(); }
      let dueAt = null;
      if (data.dueAt) { if (typeof data.dueAt !== 'string' || !Number.isFinite(Date.parse(data.dueAt)) || Date.parse(data.dueAt) <= clock()) throw new AccountError(400, 'La fecha límite debe estar en el futuro.'); dueAt = new Date(data.dueAt).toISOString(); }
      const snapshot = normalizeActivity(activity);
      return store.createAssignments(data.groupIds.map(groupId => ({ activity_id: activity.id, teacher_id: profile.id, group_id: groupId, activity_version: activity.version, snapshot, due_at: dueAt })));
    },
    async open(profile, id, studentId) {
      const assignment = await assigned(profile, id);
      if (profile.role === 'teacher' && !studentId) throw new AccountError(400, 'Selecciona un alumno para revisar.');
      const target = profile.role === 'student' ? profile.id : studentId;
      const student = await store.profile(target);
      if (!student || student.role !== 'student' || student.teacher_id !== assignment.teacher_id) throw denied();
      const submission = await store.submission(id, target);
      if (submission) answers.set(id + ':' + target, { revision: submission.revision, answer: submission.answer });
      const reviews = await store.reviewSummaries(id, target);
      const { answer: ignored, last_save_hash, ...summary } = submission || {};
      return { assignment, student: { id: student.id, control: student.control, name: student.name }, submission: submission ? summary : null, reviews, answer: submission?.answer || initialAnswer(assignment.snapshot), revision: submission?.revision || 0, writable: profile.role === 'student' && writable(assignment, submission) };
    },
    async saveAnswer(profile, data) {
      if (profile.role !== 'student') throw new AccountError(403, 'Solo el alumno puede guardar su respuesta.');
      const assignment = await assigned(profile, data.assignmentId);
      if (!Number.isInteger(data.revision) || data.revision < 0 || typeof data.submit !== 'boolean') throw new AccountError(400, 'Revisión de respuesta inválida.');
      const current = await store.submissionState(assignment.id, profile.id), key = assignment.id + ':' + profile.id;
      const delta = Object.hasOwn(data, 'patch');
      if (delta && (typeof data.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.requestId))) throw new AccountError(400, 'Identificador de guardado inválido.');
      if (delta && current?.last_save_id === data.requestId) return store.saveDelta(assignment.id, profile.id, data.revision, data.patch, data.requestId, data.submit);
      if (!writable(assignment, current)) throw new AccountError(403, 'La respuesta ya fue entregada o la actividad está cerrada.');
      if ((current?.revision || 0) !== data.revision) throw new AccountError(409, 'Conflicto de revisión: hay cambios en otra sesión. Recarga antes de guardar.');
      let answer;
      try {
        if (delta) {
          let cached = answers.get(key);
          if (cached?.revision !== data.revision) cached = current ? await store.submission(assignment.id, profile.id) : { answer: initialAnswer(assignment.snapshot) };
          const reconstructed = applyAnswerPatch(cached.answer, data.patch);
          answer = validateAnswer(assignment.snapshot, reconstructed);
          if (!sameAnswer(answer, reconstructed)) throw new Error('Los cambios contienen campos no permitidos.');
        } else answer = validateAnswer(assignment.snapshot, data.answer);
      } catch (error) { throw new AccountError(400, error.message); }
      const receipt = delta ? await store.saveDelta(assignment.id, profile.id, data.revision, data.patch, data.requestId, data.submit) : await store.saveAnswer(assignment.id, profile.id, data.revision, answer, data.submit);
      answers.set(key, { revision: receipt.revision, answer }); return receipt;
    },
    async progress(profile, id, token) {
      if (profile.role !== 'teacher') throw new AccountError(403, 'Solo el profesor puede consultar avances.');
      if (token !== undefined && (typeof token !== 'string' || token.length > 128)) throw new AccountError(400, 'Marcador de avances inválido.');
      return store.progressSummary(id, profile.id, token || null);
    },
    async review(profile, data) {
      if (profile.role !== 'teacher') throw new AccountError(403, 'Solo el profesor puede revisar entregas.');
      const assignment = await assigned(profile, data.assignmentId, false);
      const student = await store.profile(data.studentId);
      if (!student || student.role !== 'student' || student.teacher_id !== profile.id) throw denied();
      if (!['review', 'return'].includes(data.action) || !Number.isInteger(data.revision) || data.revision < 1 ||
        !(data.grade === null || (typeof data.grade === 'number' && Number.isFinite(data.grade) && data.grade >= 0 && data.grade <= 100 && Math.abs(data.grade * 100 - Math.round(data.grade * 100)) < 1e-8)) ||
        typeof data.feedback !== 'string' || data.feedback.length > 10000) throw new AccountError(400, 'Usa una calificación de 0 a 100 con hasta dos decimales y comentarios de hasta 10 000 caracteres.');
      const submission = await store.submission(assignment.id, student.id);
      if (!submission?.submitted_at) throw new AccountError(409, 'El alumno debe entregar antes de revisar o devolver.');
      if (submission.revision !== data.revision) throw new AccountError(409, 'La entrega cambió. Vuelve a abrirla antes de revisar.');
      let deadline = null;
      if (data.action === 'return') {
        if (assignment.closed) throw new AccountError(409, 'Reabre la actividad antes de devolverla.');
        if (!student.active || student.must_change_password || !await store.isMember(assignment.group_id, student.id)) throw new AccountError(409, 'El alumno debe estar activo y pertenecer al grupo para corregir.');
        if (!data.feedback.trim() || typeof data.correctionDueAt !== 'string' || !Number.isFinite(Date.parse(data.correctionDueAt)) || Date.parse(data.correctionDueAt) <= clock()) throw new AccountError(400, 'Indica qué corregir y una fecha límite futura.');
        deadline = new Date(data.correctionDueAt).toISOString();
      }
      return store.reviewAnswer(assignment.id, student.id, profile.id, data.revision, data.action, data.grade, data.feedback.trim(), deadline);
    },
    async reviewHistory(profile, data) {
      const assignment = await assigned(profile, data.assignmentId);
      const target = profile.role === 'student' ? profile.id : data.studentId;
      const student = await store.profile(target);
      if (!student || student.teacher_id !== assignment.teacher_id || student.role !== 'student') throw denied();
      const review = await store.review(data.reviewId, assignment.id, target);
      if (!review) throw denied();
      return { review, assignment };
    },
    async deleteAssignment(profile, data) {
      if (profile.role !== 'teacher') throw new AccountError(403, 'Solo el profesor puede eliminar asignaciones.');
      const assignment = await assigned(profile, data.assignmentId, false);
      await store.deleteAssignment(assignment.id, profile.id); templates.delete(assignment.id);
      return { deleted: true };
    },
    async close(profile, data) { const assignment = await assigned(profile, data.assignmentId); if (profile.role !== 'teacher' || typeof data.closed !== 'boolean') throw new AccountError(403, 'Solo el profesor puede cerrar actividades.'); return store.setAssignmentClosed(assignment.id, data.closed); },
  };
}
