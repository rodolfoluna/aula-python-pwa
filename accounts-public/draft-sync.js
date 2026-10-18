import { answerPatch, sameAnswer } from '../dist/answer-patch.js';
export class DraftSync {
  constructor({ key, answer, revision, storage, save, validate = value => value, status = () => {}, delta = false, lastSaveId }) {
    Object.assign(this, { key, answer: structuredClone(answer), base: structuredClone(answer), revision, storage, saveRequest: save, status, delta });
    this.dirty = false; this.conflict = false; this.blocked = false; this.generation = 0; this.inFlight = null; this.pending = null; this.failures = 0; this.nextRetryAt = 0;
    try {
      const cached = JSON.parse(storage?.getItem(key) || 'null');
      if (cached?.dirty) {
        this.answer = validate(cached.answer); this.pending = delta ? cached.pending || null : null;
        if (this.pending && this.pending.payload.requestId === lastSaveId && revision === this.pending.payload.revision + 1) {
          this.base = validate(this.pending.answer); this.pending = null;
        } else if (cached.revision !== revision) { this.conflict = true; this.revision = cached.revision; }
        this.dirty = !!this.pending || !sameAnswer(this.answer, this.base);
      }
    } catch { this.answer = structuredClone(answer); this.pending = null; this.dirty = false; this.conflict = false; this.revision = revision; }
    this.notify();
  }
  notify(message, kind) {
    const text = message || (this.conflict ? 'Hay cambios de otra sesión. La copia local se conserva; recarga para resolver el conflicto.' : this.dirty ? 'Cambios pendientes de sincronizar' : 'Guardado en Supabase');
    this.status(text + (this.cacheFailed && this.dirty ? ' No se pudo guardar la copia local; mantén esta página abierta.' : ''), kind || (this.conflict ? 'error' : this.dirty ? 'pending' : 'saved'));
  }
  cache() {
    try {
      if (this.dirty) this.storage?.setItem(this.key, JSON.stringify({ answer: this.answer, revision: this.revision, dirty: true, ...(this.pending ? { pending: this.pending } : {}) }));
      else this.storage?.removeItem(this.key);
      this.cacheFailed = false;
    } catch { this.cacheFailed = true; }
  }
  set(answer) { this.answer = structuredClone(answer); this.dirty = !!this.pending || !sameAnswer(this.answer, this.base); this.generation++; this.cache(); this.notify(); }
  async flush(submit = false, options = {}) {
    if (this.inFlight) { await this.inFlight; if (submit || this.dirty) return this.flush(submit, options); return; }
    if (this.conflict || this.blocked) throw new Error('Recarga la actividad antes de volver a guardar. Tu copia local se conserva.');
    if (!this.dirty && !submit) return;
    if (!this.pending) {
      const answer = structuredClone(this.answer);
      const payload = this.delta ? { patch: this.revision === 0 ? { changes: [{ path: [], value: answer }] } : answerPatch(this.base, answer), requestId: crypto.randomUUID(), revision: this.revision, submit } : { answer, revision: this.revision, submit };
      this.pending = { answer, payload }; this.dirty = true; this.cache();
    }
    const pending = this.pending;
    this.notify(pending.payload.submit ? 'Confirmando entrega…' : 'Guardando…', 'pending');
    this.inFlight = (async () => {
      await Promise.resolve();
      try {
        const submission = await this.saveRequest(pending.payload, options);
        this.revision = submission.revision; this.base = structuredClone(pending.answer); this.pending = null;
        this.dirty = !sameAnswer(this.answer, this.base); this.submitted = !!submission.submitted_at; this.failures = 0; this.nextRetryAt = 0;
        this.cache(); this.notify(this.submitted ? 'Entrega confirmada por el servidor' : undefined, this.submitted ? 'saved' : undefined);
        return submission;
      } catch (error) {
        if (error.status === 409) this.conflict = true;
        if (error.status === 403) this.blocked = true;
        this.failures++; this.nextRetryAt = Date.now() + Math.min(300000, 60000 * 2 ** (this.failures - 1));
        this.cache(); this.notify(error.message + ' Tu copia local se conserva.', 'error'); throw error;
      } finally { this.inFlight = null; }
    })();
    const result = await this.inFlight;
    if (submit && !pending.payload.submit) return this.flush(true, options);
    return result;
  }
}
