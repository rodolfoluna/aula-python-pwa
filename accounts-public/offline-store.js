import { applyAnswerPatch } from '../dist/answer-patch.js';
export function indexedStore(indexedDB = globalThis.indexedDB) {
  let opened;
  const db = () => opened ||= new Promise((resolve, reject) => {
    if (!indexedDB) return reject(new Error('Este navegador no permite almacenamiento sin conexión.'));
    const request = indexedDB.open('aula-offline', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  async function transaction(mode, action) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('records', mode); let result;
      const request = action(tx.objectStore('records'));
      if (request) request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error || new Error('No se pudo guardar en el dispositivo.'));
    });
  }
  return { get: key => transaction('readonly', store => store.get(key)), set: (key, value) => transaction('readwrite', store => store.put(value, key)), delete: key => transaction('readwrite', store => store.delete(key)),
    batch: entries => transaction('readwrite', store => { for (const [key, value] of entries) store.put(value, key); }),
    deletePrefix: prefix => transaction('readwrite', store => { const request = store.openCursor(); request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (String(cursor.key).startsWith(prefix)) cursor.delete(); cursor.continue(); }; }) };
}
export class OfflineWorkspace {
  constructor(store = indexedStore()) { this.store = store; this.active = null; this.offline = false; this.needsIdentity = false; this.job = null; }
  key(userId, path, data) { return `user:${userId}:${path}${path === 'activity-open' ? ':' + data.assignmentId : ''}`; }
  async load() { this.active = await this.store.get('active') || null; return this.active; }
  async prepare(profile, status, catalog, groups, opened) {
    if (profile.role !== 'student' || profile.must_change_password) throw new Error('Prepara las actividades desde una cuenta de alumno que ya cambió su contraseña.');
    const active = { profile: structuredClone(profile), status, preparedAt: new Date().toISOString() };
    await this.store.batch([['active', active], [this.key(profile.id, 'activities'), catalog], [this.key(profile.id, 'my-groups'), groups], ...opened.map(data => [this.key(profile.id, 'activity-open', { assignmentId: data.assignment.id }), data])]);
    this.active = active; return active;
  }
  enabled(profile) { return profile?.role === 'student' && this.active?.profile.id === profile.id; }
  async remember(profile, path, data, result) {
    if (!this.enabled(profile)) return;
    if (path === 'activities') {
      const previous = await this.store.get(this.key(profile.id, path));
      const visible = new Set(result.assignments.map(item => item.id));
      for (const assignment of previous?.assignments || []) if (!visible.has(assignment.id)) await this.store.delete(this.key(profile.id, 'activity-open', { assignmentId: assignment.id }));
    }
    if (['activities', 'my-groups'].includes(path) || path === 'activity-open' && !data?.studentId) await this.store.set(this.key(profile.id, path, data), result);
    if (path === 'answer-save') {
      const key = this.key(profile.id, 'activity-open', data), saved = await this.store.get(key);
      if (!saved || saved.revision !== data.revision) return;
      saved.answer = data.patch ? applyAnswerPatch(saved.answer, data.patch) : structuredClone(data.answer);
      saved.revision = result.submission.revision;
      saved.submission = { ...saved.submission, ...result.submission, student_id: profile.id, last_save_id: data.requestId || null };
      saved.writable = !saved.submission.submitted_at && !saved.assignment.closed;
      await this.store.set(key, saved);
    }
  }
  async forgetAssignment(profile, assignmentId) {
    if (!this.enabled(profile)) return;
    await this.store.delete(this.key(profile.id, 'activity-open', { assignmentId }));
    const key = this.key(profile.id, 'activities'), catalog = await this.store.get(key);
    if (catalog) { catalog.assignments = catalog.assignments.filter(item => item.id !== assignmentId); await this.store.set(key, catalog); }
  }
  async read(profile, path, data) {
    if (this.active) { this.offline = true; this.needsIdentity = true; }
    if (path === 'status' && this.active) return structuredClone(this.active.status);
    if (path === 'me' && this.active) return { profile: structuredClone(this.active.profile), offline: true };
    if (!this.enabled(profile) || !['activities', 'my-groups', 'activity-open'].includes(path) || data?.studentId) return null;
    const result = await this.store.get(this.key(profile.id, path, data)); if (!result) return null;
    const copy = structuredClone(result);
    if (path === 'activity-open') {
      const deadline = copy.assignment.individual_due_at || (copy.submission?.returned_at ? copy.submission.correction_due_at : copy.assignment.due_at);
      copy.writable = !copy.assignment.closed && !copy.submission?.submitted_at && (!deadline || Date.parse(deadline) > Date.now());
      copy.offline = true;
    }
    this.offline = true; this.needsIdentity = true; return copy;
  }
  async deactivate() { const id = this.active?.profile.id; this.active = null; this.offline = false; this.needsIdentity = true; await this.store.delete('active'); if (id) await this.store.deletePrefix?.(`user:${id}:`); }
}
