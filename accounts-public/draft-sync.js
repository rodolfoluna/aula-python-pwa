export class DraftSync {
  constructor({ key, answer, revision, storage, save, validate = value => value, status = () => {} }) {
    Object.assign(this, { key, answer: structuredClone(answer), revision, storage, saveRequest: save, status });
    this.dirty = false; this.conflict = false; this.blocked = false; this.generation = 0; this.inFlight = null;
    try {
      const cached = JSON.parse(storage?.getItem(key) || 'null');
      if (cached?.dirty) { this.answer = validate(cached.answer); this.dirty = true; this.conflict = cached.revision !== revision; if (this.conflict) this.revision = cached.revision; }
    } catch { /* Un caché inválido nunca reemplaza la copia del servidor. */ }
    this.notify();
  }
  notify(message, kind) { this.status(message || (this.conflict ? 'Hay cambios de otra sesión. La copia local se conserva; recarga para resolver el conflicto.' : this.dirty ? 'Cambios pendientes de sincronizar' : 'Guardado en Supabase'), kind || (this.conflict ? 'error' : this.dirty ? 'pending' : 'saved')); }
  cache() { try { if (this.dirty) this.storage?.setItem(this.key, JSON.stringify({ answer: this.answer, revision: this.revision, dirty: true })); else this.storage?.removeItem(this.key); } catch { this.notify('No se pudo guardar la copia local. Mantén esta página abierta hasta sincronizar.', 'error'); } }
  set(answer) { this.answer = structuredClone(answer); this.dirty = true; this.generation++; this.cache(); this.notify(); }
  async flush(submit = false) {
    if (this.inFlight) { await this.inFlight; if (submit || this.dirty) return this.flush(submit); return; }
    if (this.conflict || this.blocked) throw new Error('Recarga la actividad antes de volver a guardar. Tu copia local se conserva.');
    if (!this.dirty && !submit) return;
    const generation = this.generation, payload = { answer: structuredClone(this.answer), revision: this.revision, submit };
    this.notify(submit ? 'Confirmando entrega…' : 'Guardando…', 'pending');
    this.inFlight = (async () => {
      await Promise.resolve();
      try {
        const submission = await this.saveRequest(payload); this.revision = submission.revision;
        this.dirty = this.generation !== generation; this.submitted = !!submission.submitted_at;
        this.cache(); this.notify(this.submitted ? 'Entrega confirmada por el servidor' : undefined, this.submitted ? 'saved' : undefined);
        return submission;
      } catch (error) {
        if (error.status === 409) this.conflict = true;
        if (error.status === 403) this.blocked = true;
        this.cache(); this.notify(error.message + ' Tu copia local se conserva.', 'error'); throw error;
      } finally { this.inFlight = null; }
    })();
    return this.inFlight;
  }
}
