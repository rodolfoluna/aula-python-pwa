import { DraftSync } from './draft-sync.js';
import { validateAnswer } from '../dist/activity-model.js';
import { sameAnswer } from '../dist/answer-patch.js';

export function pendingKeys(storage, userId) {
  return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(key => key?.startsWith(`aula-answer:${userId}:`));
}
// Reutiliza las mismas operaciones idempotentes y comprobaciones de revisión que el editor.
export async function syncPending({ profile, storage, api, current = () => null }) {
  const identity = (await api('me', undefined, { networkOnly: true })).profile;
  if (identity?.id !== profile.id || identity.role !== 'student' || identity.must_change_password) throw new Error('Inicia sesión con la cuenta dueña de estos avances para sincronizarlos.');
  let saved = 0, held = 0;
  for (const key of pendingKeys(storage, profile.id)) {
    const assignmentId = key.slice(`aula-answer:${profile.id}:`.length);
    try {
      const active = current();
      if (active?.assignmentId === assignmentId) {
        if (active.writable === false) { held++; continue; }
        if (active.sync?.dirty) await active.sync.flush();
        if (active.sync?.dirty) held++; else saved++;
        continue;
      }
      const data = await api('activity-open', { assignmentId }, { networkOnly: true });
      const cached = JSON.parse(storage.getItem(key) || 'null');
      if (!cached?.dirty) continue;
      if (!data.writable) {
        if (cached.pending?.payload.requestId === data.submission?.last_save_id && sameAnswer(cached.answer, data.answer)) { storage.removeItem(key); saved++; }
        else held++;
        continue;
      }
      const draft = new DraftSync({ key, storage, answer: data.answer, revision: data.revision, delta: true, lastSaveId: data.submission?.last_save_id,
        validate: value => validateAnswer(data.assignment.snapshot, value),
        save: async payload => (await api('answer-save', { assignmentId, actorId: profile.id, ...payload }, { networkOnly: true })).submission });
      if (draft.conflict) { held++; continue; }
      if (draft.dirty) await draft.flush(); else draft.cache();
      saved++;
    } catch (error) {
      if (!error.status || error.status === 401) throw error;
      held++;
    }
  }
  return { saved, held };
}

export function setupPwa({ workspace, api, getProfile, getRunnerOrigin, current, perform }) {
  const $ = id => document.getElementById(id);
  if (!$('pwa-status')) return { render() {}, resume() {}, wait: async () => {} };
  let prompt, job, preparing = false, detail = '', worker, nextAttempt = 0;
  const supported = !!navigator.serviceWorker && !!globalThis.indexedDB;
  function render() {
    const profile = getProfile(), offline = navigator.onLine === false || workspace.offline;
    $('prepare-offline').hidden = profile?.role !== 'student' || profile.must_change_password;
    $('prepare-offline').disabled = preparing || navigator.onLine === false;
    $('sync-offline').hidden = profile?.role !== 'student';
    $('sync-offline').disabled = !!job || preparing || navigator.onLine === false;
    let count = 0; try { if (profile) count = pendingKeys(localStorage, profile.id).length; } catch {}
    $('pwa-status').textContent = `${offline ? 'Sin conexión · copia local' : 'Con conexión'}${workspace.enabled(profile) ? ' · Actividades preparadas en este equipo' : ''}${count ? ` · ${count} actividad(es) con avances pendientes` : ''}. ${detail || (profile?.role === 'teacher' ? 'La preparación sin conexión se hace desde la cuenta del alumno.' : '')}`;
  }
  async function resume(force = false) {
    const profile = getProfile();
    if (job || preparing || !profile || profile.role !== 'student' || profile.must_change_password || navigator.onLine === false || !force && Date.now() < nextAttempt) return job;
    let keys; try { keys = pendingKeys(localStorage, profile.id); } catch { return; }
    if (!keys.length) { render(); return; }
    nextAttempt = Date.now() + 300000;
    job = syncPending({ profile, storage: localStorage, api, current }).then(({ saved, held }) => {
      workspace.offline = false; detail = `${saved} actividad(es) sincronizadas.${held ? ` ${held} requieren revisión: abre la actividad; se conserva su copia local.` : ''}`;
    }).catch(error => { detail = `${error.message} Los avances pendientes siguen en este equipo; si tu sesión venció, vuelve a iniciar sesión.`; }).finally(() => { job = null; render(); });
    render(); return job;
  }
  async function preparePython() {
    const origin = getRunnerOrigin(), frame = document.createElement('iframe');
    frame.hidden = true; frame.title = 'Preparación de Python sin conexión'; frame.setAttribute('sandbox', 'allow-scripts allow-same-origin'); frame.setAttribute('allow', 'cross-origin-isolated');
    frame.src = origin + '/runner.html?parent=' + encodeURIComponent(location.origin);
    await new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); error ? reject(error) : resolve(); };
      const timer = setTimeout(() => finish(new Error('La preparación de Python tardó demasiado. Puedes reintentar; se reutilizan las descargas completas.')), 600000);
      function receive(event) {
        if (event.source !== frame.contentWindow || event.origin !== origin) return;
        if (event.data?.type === 'aula-ready') frame.contentWindow.postMessage({ type: 'aula-prepare-offline' }, origin);
        if (event.data?.type !== 'aula-offline-progress') return;
        if (event.data.error) return finish(new Error(event.data.error));
        detail = `Descargando Python y Matplotlib: ${event.data.done || event.data.total}/${event.data.total} archivos…`; render();
        if (event.data.ready) finish();
      }
      window.addEventListener('message', receive); document.body.append(frame);
    });
  }
  $('prepare-offline').onclick = () => perform(async () => {
    if (!supported) throw new Error('Este navegador no permite preparar la app sin conexión.');
    if (!confirm('Se guardarán tus actividades y respuestas en este dispositivo para abrirlas sin conexión. Hazlo en un equipo personal. ¿Continuar?')) return;
    await job;
    preparing = true; detail = 'Preparando actividades…'; render();
    try {
      await worker;
      const profile = getProfile(), status = await api('status', undefined, { networkOnly: true });
      const catalog = await api('activities', undefined, { networkOnly: true }), groups = await api('my-groups', undefined, { networkOnly: true }), opened = [];
      for (const assignment of catalog.assignments) opened.push(await api('activity-open', { assignmentId: assignment.id }, { networkOnly: true }));
      if (getProfile()?.id !== profile.id) throw new Error('La sesión cambió durante la preparación.');
      await workspace.prepare(profile, status, catalog, groups, opened);
      await preparePython();
      await navigator.storage?.persist?.().catch(() => false);
      detail = `Listo: ${opened.length} actividad(es), Python y Matplotlib disponibles sin conexión. Los avances se sincronizan al volver Internet con la app abierta. La entrega final requiere conexión.`;
    } catch (error) { detail = `Preparación incompleta: ${error.message} Reintenta con Internet antes de trabajar sin conexión.`; throw error; }
    finally { preparing = false; render(); }
  });
  $('sync-offline').onclick = () => { detail = ''; return resume(true); };
  $('install-app').onclick = async () => {
    if (prompt) { await prompt.prompt(); await prompt.userChoice; prompt = null; }
    else detail = 'Abre el menú del navegador y elige «Instalar Aula Python» o «Añadir a pantalla de inicio». En iPhone/iPad usa Compartir en Safari.';
    render();
  };
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event; });
  window.addEventListener('appinstalled', () => { detail = 'Aula Python está instalada.'; render(); });
  window.addEventListener('offline', () => { workspace.offline = true; workspace.needsIdentity = true; detail = ''; render(); });
  window.addEventListener('online', () => { detail = ''; resume(true); render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
  const timer = setInterval(() => { render(); if (!document.hidden) resume(); }, 60000); timer.unref?.();
  worker = supported ? navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(() => navigator.serviceWorker.ready) : Promise.reject(new Error('Service Worker no disponible.'));
  worker.catch(() => { detail = 'La preparación sin conexión no está disponible en este navegador.'; render(); });
  render(); return { render, resume, wait: async () => { await job; } };
}
