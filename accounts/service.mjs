import { randomBytes } from 'node:crypto';
import { normalizeStudent } from '../accounts-public/csv.js';
export class AccountError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const temporaryPassword = () => randomBytes(18).toString('base64url');
export const studentEmail = control => `${normalizeStudent({ control, name: 'Alumno' }).control.toLowerCase()}@alumnos.aula.invalid`;
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new AccountError(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
}
export function createAccountsService(store) {
  async function requireStudent(teacher, studentId) {
    const student = await store.profile(studentId);
    if (!student || student.role !== 'student' || student.teacher_id !== teacher.id) throw new AccountError(404, 'Alumno no encontrado.');
    return student;
  }
  async function requireGroup(teacher, groupId) {
    const group = await store.group(groupId);
    if (!group || group.teacher_id !== teacher.id) throw new AccountError(404, 'Grupo no encontrado.');
    return group;
  }
  return {
    async importStudents(teacher, rows, groupId) {
      if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new AccountError(400, 'Envía entre 1 y 500 alumnos.');
      if (groupId) await requireGroup(teacher, groupId);
      const created = [], rejected = [];
      for (const [index, row] of rows.entries()) {
        let student;
        try {
          student = normalizeStudent(row);
          if (await store.findStudent(student.control)) throw new Error('El número de control ya está registrado; su contraseña no se modificó.');
          const password = temporaryPassword();
          const profile = await store.createUser({ ...student, email: studentEmail(student.control), password, role: 'student', teacherId: teacher.id });
          const record = { ...student, id: profile.id, password };
          created.push(record);
          if (groupId) {
            try { await store.setMembership(groupId, profile.id, true); }
            catch { record.warning = 'Cuenta creada, pero no se pudo agregar al grupo. Puedes asignarla desde Grupos.'; }
          }
        } catch (error) {
          rejected.push({ row: index + 1, control: student?.control || String(row?.control || ''), message: /ya está registrado|Número de control inválido|nombre debe/.test(error.message) ? error.message : 'No se pudo crear esta cuenta. Revisa Supabase antes de reintentar.' });
        }
      }
      return { created, rejected };
    },
    async createGroup(teacher, value) {
      const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
      if (!name || name.length > 100) throw new AccountError(400, 'El grupo debe tener entre 1 y 100 caracteres.');
      if ((await store.listGroups(teacher.id)).some(group => group.name === name)) throw new AccountError(409, 'Ya existe un grupo con ese nombre.');
      return store.createGroup(teacher.id, name);
    },
    async membership(teacher, groupId, studentId, member) {
      if (typeof member !== 'boolean') throw new AccountError(400, 'La asignación no es válida.');
      await requireGroup(teacher, groupId); await requireStudent(teacher, studentId);
      await store.setMembership(groupId, studentId, member);
    },
    async resetPassword(teacher, id) {
      const student = await requireStudent(teacher, id), password = temporaryPassword();
      await store.updateProfile(id, { must_change_password: true });
      await store.setPassword(id, password);
      return { control: student.control, name: student.name, password };
    },
    async setActive(teacher, id, active) {
      if (typeof active !== 'boolean') throw new AccountError(400, 'Estado de cuenta inválido.');
      await requireStudent(teacher, id); await store.updateProfile(id, { active });
    },
    async changePassword(profile, email, current, password) {
      validatePassword(password);
      if (current === password) throw new AccountError(400, 'Elige una contraseña distinta de la actual.');
      let userId;
      try { userId = await store.login(email, current); } catch { throw new AccountError(401, 'La contraseña actual no es correcta.'); }
      if (userId !== profile.id) throw new AccountError(401, 'La contraseña actual no es correcta.');
      await store.setPassword(profile.id, password);
      await store.updateProfile(profile.id, { must_change_password: false });
    },
  };
}
