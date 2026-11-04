import { normalizeActivity, validateAnswer, newActivity, clone } from '../dist/activity-model.js';
import { renderMarkdown } from '../dist/markdown.js';
import { createWorksheet } from './worksheet.js';
import { DraftSync } from './draft-sync.js';
import { PollBudget } from './sync-policy.js';
import { createNavigation } from './navigation.js';
const $ = selector => document.querySelector(selector);
const date = value => value ? new Date(value).toLocaleString('es-MX') : 'Sin fecha límite';
const reviewedCurrent = sub => sub?.reviewed_at && sub?.submitted_at && Date.parse(sub.reviewed_at) >= Date.parse(sub.submitted_at);
const answerStatus = sub => !sub ? 'Sin iniciar' : sub.submitted_at ? (reviewedCurrent(sub) ? 'Revisada' : 'Entregada') : sub.returned_at ? 'Devuelta para correcciones' : 'En progreso';
const gradeText = sub => sub?.grade == null ? 'Sin calificación' : `${Number(sub.grade)}/100${reviewedCurrent(sub) ? '' : ' · Nota de la revisión anterior (provisional)'}`;
export function setupActivities({ api, perform, getGroups, getProfile, getRunnerOrigin, beforeOpen = async () => {} }) {
  const progressBudget = new PollBudget(), progressTokens = new Map(), progressFlights = new Map();
  let sessionKey, profile, view = 'roster', catalog = { activities: [], assignments: [] }, draft, draftDirty = false, reviewDirty = false, worksheet, sync, opened, progressId, reviewedStudent, ticker, frame, runnerReady, runnerBusy, queued, runnerTimer, cacheKey, epoch = 0;
  const notice = (text, error = false) => { $('#activities-notice').textContent = text; $('#activities-notice').hidden = !text; $('#activities-notice').className = error ? 'error' : ''; };
  const navigation = createNavigation({ window, canLeave: () => !document.querySelector('#logout:disabled') && canLeave(), onError: error => notice(error.message, true) });
  const element = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  function button(text, action) { const el = element('button', text); el.type = 'button'; el.onclick = () => perform(action); return el; }
  function syncControls() {
    worksheet?.syncControls();
    $('#workspace-nav').hidden = !profile || profile.role !== 'teacher' || profile.must_change_password;
    if (sync) { $('#save-answer').disabled = !opened?.writable || sync.conflict || sync.blocked || !!sync.inFlight; $('#submit-answer').disabled = $('#save-answer').disabled || window.navigator?.onLine === false; }
    document.querySelectorAll('.worksheet-run').forEach(button => { if (button.textContent.includes('Ejecutar')) button.disabled = !!runnerBusy; });
  }
  function screen(mode) {
    $('#activities-hub').dataset.screen = mode;
    $('#roster-nav').setAttribute('aria-current', view === 'roster' ? 'page' : 'false');
    $('#activities-nav').setAttribute('aria-current', view === 'activities' ? 'page' : 'false');
    document.body.dataset.workspace = mode;
    $('#activity-progress').hidden = mode !== 'progress';
    const target = mode === 'work' ? $('#work-title') : mode === 'progress' ? $('#activity-progress h2') : $('#activities-heading');
    target.tabIndex = -1; target.focus(); target.scrollIntoView?.({ block: 'start' });
  }
  function teardown() {
    epoch++;
    clearInterval(ticker); clearTimeout(runnerTimer); ticker = null; frame?.remove(); frame = null; queued = null; runnerBusy = false; runnerReady = false;
    worksheet?.destroy(); worksheet = null; sync = null; opened = null; draft = null; draftDirty = false; reviewDirty = false; reviewedStudent = null; $('#activity-workspace').hidden = true; screen('catalog');
    for (const id of ['feedback-panel', 'review-form', 'review-history', 'back-current-review']) $('#' + id).hidden = true;
  }
  function canLeave() { if (navigation.restoring) return true; if (sync?.inFlight) { notice('Espera a que termine el guardado antes de cambiar de actividad.', true); return false; } if (reviewDirty) return confirm('Hay comentarios o una calificación sin guardar. ¿Salir y descartar esos cambios?'); return !(sync?.dirty || draftDirty) || confirm('Hay cambios sin guardar en el servidor. Se conserva la copia local. ¿Quieres salir de esta actividad?'); }
  const runnerUnavailable = () => new URL(getRunnerOrigin()).protocol === 'https:' ? 'La consola Python no respondió. Vuelve a abrir la actividad; si continúa, avisa al profesor.' : 'La consola no respondió. Inicia npm run dev en otra terminal y vuelve a abrir la actividad.';
  function startRunner(student) {
    frame?.remove(); clearTimeout(runnerTimer); runnerReady = false; runnerBusy = false; queued = null;
    frame = document.createElement('iframe'); frame.title = 'Consola de Python aislada'; frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms'); frame.setAttribute('allow', 'cross-origin-isolated');
    frame.src = getRunnerOrigin() + '/runner.html?parent=' + encodeURIComponent(location.origin);
    $('#runner-host').replaceChildren(frame); $('#runner-state').textContent = 'Iniciando consola aislada…';
    runnerTimer = setTimeout(() => { if (!runnerReady) $('#runner-state').textContent = runnerUnavailable(); }, 15000);
    frame.dataset.student = String(student);
  }
  function run(items) {
    if (!items.length || runnerBusy) return;
    if (!runnerReady) { notice(runnerUnavailable(), true); return; }
    runnerBusy = true; syncControls(); $('#runner-state').textContent = 'Ejecutando Python…'; frame.contentWindow.postMessage({ type: 'aula-run', items }, getRunnerOrigin());
  }
  window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== getRunnerOrigin()) return;
    if (event.data?.type === 'aula-ready') { runnerReady = true; clearTimeout(runnerTimer); $('#runner-state').textContent = 'Consola lista'; frame.contentWindow.postMessage({ type: 'aula-config', student: frame.dataset.student === 'true', theme: document.documentElement.dataset.theme || 'light' }, getRunnerOrigin()); }
    if (event.data?.type === 'aula-busy') { runnerBusy = event.data.busy === true; $('#runner-state').textContent = runnerBusy ? 'Ejecutando Python…' : 'Ejecución terminada. Revisa la consola.'; syncControls(); }
  });
  window.addEventListener('aula-theme-change', () => { if (frame && runnerReady) frame.contentWindow.postMessage({ type: 'aula-theme', theme: document.documentElement.dataset.theme }, getRunnerOrigin()); });
  function cacheDraft() {
    draftDirty = true; $('#draft-state').textContent = 'Cambios sin guardar en Supabase';
    try { localStorage.setItem(cacheKey, JSON.stringify(draft)); } catch { notice('No se pudo conservar el borrador local. Guarda antes de cerrar.', true); }
  }
  function showDraft(activity, replace = false) {
    if (!canLeave()) return;
    teardown(); draft = clone(activity); cacheKey = 'aula-activity-draft:' + profile.id + ':' + (draft.id || 'new');
    try { const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (cached && cached.kind === draft.kind && cached.version === draft.version) { draft = { ...cached, ...normalizeActivity(cached) }; draftDirty = true; } } catch {}
    $('#activity-workspace').hidden = false; screen('work'); $('#teacher-draft-fields').hidden = false; $('#answer-controls').hidden = true; $('#work-readonly').hidden = true;
    $('#work-title').textContent = draft.id ? 'Editar plantilla · versión ' + draft.version : 'Crear actividad'; $('#activity-title').value = draft.title; $('#activity-instructions').value = draft.instructions;
    $('#draft-state').textContent = draftDirty ? 'Borrador local recuperado; todavía no está guardado en Supabase.' : 'Guarda antes de asignar a un grupo.';
    $('#work-instructions').replaceChildren(); worksheet = createWorksheet($('#worksheet'), { activity: draft, role: 'teacher', onChange: cacheDraft, onSave: () => $('#save-activity').click(), run, notice }); startRunner(false); syncControls();
    navigation.record('draft:' + (activity.id || activity.kind), () => showDraft(activity), replace);
  }
  async function openAnswer(assignmentId, studentId, force = false, discardLocal = false) {
    if (!force && !canLeave()) return;
    await beforeOpen();
    const data = await api('activity-open', { assignmentId, ...(studentId ? { studentId } : {}) }, discardLocal ? { networkOnly: true } : {});
    if (discardLocal) localStorage.removeItem(`aula-answer:${profile.id}:${assignmentId}`);
    teardown(); opened = data; reviewedStudent = studentId;
    const own = profile.role === 'student', ownerId = profile.id, template = data.assignment.snapshot, currentEpoch = epoch;
    $('#activity-workspace').hidden = false; screen('work'); $('#teacher-draft-fields').hidden = true; $('#answer-controls').hidden = !own;
    $('#work-title').textContent = `${template.title} · versión ${data.assignment.activity_version}${!own && data.student ? ' · ' + data.student.control + ' · ' + data.student.name : ''}`; renderMarkdown($('#work-instructions'), template.instructions);
    $('#work-readonly').hidden = data.writable;
    let answer = data.answer;
    if (own) {
      sync = new DraftSync({ key: `aula-answer:${ownerId}:${assignmentId}`, answer, revision: data.revision, delta: true, lastSaveId: data.submission?.last_save_id, storage: localStorage, validate: value => validateAnswer(template, value),
        save: async (payload, options) => (await api('answer-save', { assignmentId, actorId: ownerId, ...payload }, options)).submission,
        status: (text, kind) => { if (currentEpoch === epoch) { $('#answer-state').textContent = text; $('#answer-state').className = kind; } },
      });
      answer = sync.answer;
      if (!data.writable) $('#answer-state').textContent = sync.dirty ? 'Se muestra tu copia local pendiente. La actividad está cerrada, vencida o entregada; no se sobrescribirá la versión del servidor.' : data.submission?.submitted_at ? 'Entregada · ' + date(data.submission.submitted_at) : 'Actividad cerrada o vencida';
      ticker = setInterval(() => { if (!document.hidden) autoSave(); }, 60000);
      ticker.unref?.();
    }
    worksheet = createWorksheet($('#worksheet'), { activity: template, answer, role: own ? 'student' : 'review', readonly: !data.writable,
      onChange: () => sync?.set(answer), onSave: () => $('#save-answer').click(), run, notice }); startRunner(own); if (own && data.writable && template.kind === 'files') sync.set(answer); syncControls();
    renderFeedback(data, own);
    navigation.record('answer:' + assignmentId + ':' + (studentId || ''), () => openAnswer(assignmentId, studentId));
  }
  function renderFeedback(data, own) {
    const sub = data.submission;
    $('#feedback-panel').hidden = !sub?.reviewed_at;
    if (sub?.reviewed_at) {
      $('#feedback-state').textContent = `${answerStatus(sub)} · ${gradeText(sub)} · Revisada: ${date(sub.reviewed_at)}${sub.returned_at && !sub.submitted_at ? ' · Corrige antes de: ' + date(sub.correction_due_at) : ''}`;
      renderMarkdown($('#feedback-text'), sub.feedback || 'Sin comentarios.');
    }
    $('#review-form').hidden = own || !sub?.submitted_at;
    $('#review-grade').value = sub?.grade ?? ''; $('#review-feedback').value = sub?.feedback || '';
    const future = new Date(Date.now() + 7 * 86400000); future.setMinutes(future.getMinutes() - future.getTimezoneOffset());
    $('#correction-due').value = future.toISOString().slice(0, 16);
    $('#review-state').textContent = ''; reviewDirty = false;
    $('#reviews-list').replaceChildren(); $('#review-history').hidden = !data.reviews?.length;
    for (const review of data.reviews || []) {
      const item = element('details'), summary = element('summary', `${date(review.created_at)} · ${review.action === 'return' ? 'Devuelta para correcciones' : 'Revisión'} · ${review.grade == null ? 'Sin calificación' : Number(review.grade) + '/100'}`);
      const comment = element('div', undefined, 'activity-markdown'); renderMarkdown(comment, review.feedback || 'Sin comentarios.');
      item.append(summary, comment);
      if (review.correction_due_at) item.append(element('p', 'Plazo de corrección: ' + date(review.correction_due_at)));
      item.append(button('Ver código de esta revisión', () => showHistorical(data.assignment.id, sub.student_id, review.id)));
      $('#reviews-list').append(item);
    }
  }
  async function showHistorical(assignmentId, studentId, reviewId) {
    if (!canLeave()) return;
    const { assignment, review } = await api('review-history', { assignmentId, studentId, reviewId });
    teardown(); $('#activity-workspace').hidden = false; screen('work'); $('#teacher-draft-fields').hidden = true; $('#answer-controls').hidden = true; $('#work-readonly').hidden = false;
    $('#work-title').textContent = `${assignment.snapshot.title} · Código revisado el ${date(review.created_at)}`;
    renderMarkdown($('#work-instructions'), assignment.snapshot.instructions);
    $('#feedback-panel').hidden = false; $('#feedback-state').textContent = `${review.action === 'return' ? 'Devuelta' : 'Revisada'} · ${review.grade == null ? 'Sin calificación' : Number(review.grade) + '/100'}`;
    renderMarkdown($('#feedback-text'), review.feedback || 'Sin comentarios.');
    $('#back-current-review').hidden = false; $('#back-current-review').onclick = () => perform(() => openAnswer(assignmentId, profile.role === 'teacher' ? studentId : null));
    worksheet = createWorksheet($('#worksheet'), { activity: assignment.snapshot, answer: review.answer, role: 'review', readonly: true, run, notice }); startRunner(profile.role === 'student'); syncControls();
    navigation.record('history:' + reviewId, () => showHistorical(assignmentId, studentId, reviewId));
  }
  function renderAssignmentForm() {
    const select = $('#assignment-activity'), previous = select.value; select.replaceChildren();
    for (const activity of catalog.activities || []) { const option = element('option', `${activity.title} · v${activity.version}`); option.value = activity.id; select.append(option); }
    if ((catalog.activities || []).some(activity => activity.id === previous)) select.value = previous;
    $('#assignment-groups').replaceChildren();
    for (const group of getGroups()) { const label = element('label', undefined, 'inline-label'), box = element('input'); box.type = 'checkbox'; box.value = group.id; box.name = 'assigned-group'; label.append(box, element('span', group.name)); $('#assignment-groups').append(label); }
  }
  function deadlineForm(card, assignment) {
    if (card.querySelector('.assignment-deadline-form')) { card.querySelector('.assignment-deadline-form input').focus(); return; }
    const form = element('form', undefined, 'assignment-deadline-form');
    const localDate = ms => { const value = new Date(ms); value.setMinutes(value.getMinutes() - value.getTimezoneOffset()); return value.toISOString().slice(0, 16); };
    const previous = assignment.due_at ? Date.parse(assignment.due_at) : 0;
    const label = element('label', 'Nueva fecha límite (hora de este equipo)'), input = element('input');
    input.type = 'datetime-local'; input.required = true;
    input.value = localDate(previous || Date.now() + 86400000); label.append(input);
    const save = element('button', 'Guardar nueva fecha', 'primary'); save.type = 'submit';
    form.append(element('h4', 'Cambiar fecha límite'), label,
      element('p', 'Puedes adelantar o retrasar el plazo de esta asignación del grupo. Si eliges una fecha ya vencida, los alumnos sin entregar no podrán seguir editando. Las entregas y los plazos individuales de corrección se conservan.', 'muted'));
    if (assignment.closed) form.append(element('p', 'Esta actividad está cerrada. Usa «Reabrir actividad» para permitir que los alumnos continúen.', 'muted'));
    form.append(save, button('Cancelar cambio de fecha', () => form.remove()));
    form.onsubmit = event => { event.preventDefault(); perform(async () => {
      await api('assignment-deadline', { assignmentId: assignment.id, dueAt: new Date(input.value).toISOString() });
      await refresh(); notice('Fecha límite actualizada. Los alumnos verán el nuevo plazo al actualizar o volver a abrir la actividad con conexión.');
    }); };
    card.append(form); input.focus();
  }
  async function refresh() {
    const actorId = profile?.id, data = await api('activities'); if (!profile || profile.id !== actorId) return; catalog = data; $('#assignments-list').replaceChildren(); $('#activity-drafts').replaceChildren();
    if (profile.role === 'teacher') {
      for (const activity of catalog.activities || []) { const card = element('article', undefined, 'card'); card.append(element('h3', activity.title), element('p', `${activity.kind === 'notebook' ? 'Notebook' : 'Ejercicios con archivos'} · v${activity.version}`, 'muted'), button('Editar plantilla', async () => showDraft((await api('activity-template', { activityId: activity.id })).activity))); $('#activity-drafts').append(card); }
      renderAssignmentForm();
    }
    for (const assignment of catalog.assignments || []) {
      const card = element('article', undefined, 'card'), group = getGroups().find(group => group.id === assignment.group_id);
      card.append(element('h3', assignment.title || 'Actividad'), element('p', `${assignment.group?.name || group?.name || 'Mi grupo'} · v${assignment.activity_version} · ${assignment.closed ? 'Cerrada · ' : ''}${answerStatus(assignment.submission)}`, 'muted'), element('p', 'Límite: ' + date(assignment.submission?.returned_at && !assignment.submission?.submitted_at ? assignment.submission.correction_due_at : assignment.due_at), 'muted'));
      if (profile.role === 'student' && assignment.submission?.reviewed_at) card.append(element('p', gradeText(assignment.submission), 'grade-summary'));
      if (profile.role === 'teacher') card.append(button('Cambiar fecha límite', () => deadlineForm(card, assignment)), button('Eliminar asignación', async () => {
        if (!confirm('¿Eliminar esta asignación del grupo? Se eliminarán sus avances, entregas y revisiones. La plantilla se conserva.')) return;
        await api('assignment-delete', { assignmentId: assignment.id });
        if (progressId === assignment.id) { progressId = null; progressTokens.delete(assignment.id); }
        await refresh(); notice('Asignación eliminada.');
      }), button('Ver avances', () => showProgress(assignment.id)), button(assignment.closed ? 'Reabrir actividad' : 'Cerrar actividad', async () => { await api('assignment-state', { assignmentId: assignment.id, closed: !assignment.closed }); await refresh(); }));
      else card.append(button(assignment.submission?.submitted_at ? 'Ver mi entrega' : 'Abrir actividad', () => openAnswer(assignment.id)));
      card.querySelectorAll('button').forEach(action => {
        if (['Ver avances', 'Abrir actividad', 'Ver mi entrega', 'Editar plantilla'].includes(action.textContent)) action.classList.add('primary');
        if (action.textContent === 'Eliminar asignación') action.classList.add('danger');
      });
      $('#assignments-list').append(card);
    }
    if (!(catalog.assignments || []).length) $('#assignments-list').append(element('p', 'Todavía no hay actividades asignadas.', 'muted'));
    syncControls();
  }
  async function showProgress(id, automatic = false) {
    if (!automatic && !$('#activity-workspace').hidden && !canLeave()) return;
    if (!automatic && !$('#activity-workspace').hidden) teardown();
    if (!automatic) screen('progress');
    if (progressId !== id) progressBudget.reset();
    progressId = id;
    if (!automatic) navigation.record('progress:' + id, () => showProgress(id));
    if (progressFlights.has(id)) return progressFlights.get(id);
    const request = (async () => {
    const actorId = profile?.id;
    let data;
    try { data = await api('activity-progress', { assignmentId: id, ...(automatic && progressTokens.has(id) ? { token: progressTokens.get(id) } : {}) }); }
    catch (error) { if (progressId === id) { progressBudget.completed(false, true); $('#progress-state').textContent = 'No se pudo actualizar. Se conserva el resumen anterior; puedes pulsar Actualizar avances.'; } throw error; }
    if (!profile || profile.id !== actorId || progressId !== id) return;
    progressBudget.completed(data.unchanged); if (data.token) progressTokens.set(id, data.token);
    $('#progress-state').textContent = `Última comprobación: ${new Date().toLocaleTimeString('es-MX')}. Actualización automática cada ${progressBudget.delay / 1000} s según cambios; también puedes actualizar ahora.`;
    $('#activity-progress').hidden = $('#activities-hub').dataset.screen !== 'progress'; if (data.unchanged) return; $('#progress-list').replaceChildren();
    for (const student of data.students) { const row = element('div', undefined, 'progress-row'); row.append(element('strong', `${student.control} · ${student.name}`), element('span', `${answerStatus(student.submission)}${student.submission ? ' · ' + date(student.submission.submitted_at || student.submission.updated_at) : ''}${student.submission?.reviewed_at ? ' · ' + gradeText(student.submission) : ''}`), button('Ver último avance', () => openAnswer(id, student.id))); $('#progress-list').append(row); }
    if (!data.students.length) $('#progress-list').append(element('p', 'Este grupo todavía no tiene alumnos.'));
    })();
    progressFlights.set(id, request);
    try { return await request; } finally { if (progressFlights.get(id) === request) progressFlights.delete(id); }
  }
  const online = () => window.navigator?.onLine !== false;
  function autoSave(keepalive = false) { if (opened?.writable && online() && sync?.dirty && !sync.conflict && !sync.blocked && !sync.inFlight && Date.now() >= sync.nextRetryAt) sync.flush(false, { keepalive }).then(syncControls).catch(syncControls); }
  const progressTimer = setInterval(() => { if (profile?.role === 'teacher' && progressId && !$('#activities-hub').hidden && !document.hidden && online() && progressBudget.due()) showProgress(progressId, true).catch(() => {}); }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoSave(true); else { autoSave(); if (progressId && progressBudget.due() && online() && profile?.role === 'teacher' && !$('#activities-hub').hidden) showProgress(progressId, true).catch(() => {}); } });
  window.addEventListener('online', () => autoSave());
  window.addEventListener('offline', syncControls);
  window.addEventListener('pagehide', () => autoSave(true));
  progressTimer.unref?.();
  async function showSection(section) {
    if (!canLeave()) return;
    teardown(); view = section;
    $('#teacher-panel').hidden = profile?.role !== 'teacher' || section !== 'roster';
    $('#activities-hub').hidden = section !== 'activities';
    screen('catalog');
    if (section === 'activities') await refresh();
    navigation.record(section, () => showSection(section));
  }
  $('#roster-nav').onclick = () => perform(() => showSection('roster'));
  $('#activities-nav').onclick = () => perform(() => showSection('activities'));
  document.querySelector('.brand').onclick = event => { if (profile && !profile.must_change_password) { event.preventDefault(); perform(() => showSection(profile.role === 'teacher' ? 'roster' : 'activities')); } };
  $('#refresh-activities').onclick = () => perform(refresh); $('#refresh-progress').onclick = () => perform(() => showProgress(progressId));
  $('#new-notebook-activity').onclick = () => showDraft(newActivity('notebook')); $('#new-files-activity').onclick = () => showDraft(newActivity('files'));
  $('#activity-title').oninput = () => { if (draft) { draft.title = $('#activity-title').value; cacheDraft(); } };
  $('#activity-instructions').oninput = () => { if (draft) { draft.instructions = $('#activity-instructions').value; cacheDraft(); } };
  $('#save-activity').onclick = () => perform(async () => {
    if (!draft) return;
    const clean = normalizeActivity(draft), result = await api('activity-save', { ...clean, ...(draft.id ? { id: draft.id, version: draft.version } : {}) });
    localStorage.removeItem(cacheKey); draftDirty = false; await refresh(); showDraft(result.activity, true); notice('Actividad guardada. Ya puedes asignar esta versión a grupos.');
  });
  $('#assignment-form').onsubmit = event => { event.preventDefault(); perform(async () => {
    const activity = (catalog.activities || []).find(activity => activity.id === $('#assignment-activity').value);
    if (!activity) throw new Error('Primero guarda una actividad.');
    if (draftDirty && (!draft.id || draft.id === activity.id)) throw new Error('Guarda primero los cambios de la plantilla.');
    const groupIds = [...document.querySelectorAll('[name="assigned-group"]:checked')].map(box => box.value), dateValue = $('#assignment-due').value;
    await api('assign-activity', { activityId: activity.id, version: activity.version, groupIds, dueAt: dateValue ? new Date(dateValue).toISOString() : null }); await refresh(); notice('Actividad asignada. Los alumnos del grupo ya pueden abrirla.');
  }); };
  $('#save-answer').onclick = () => perform(async () => { if (!online()) { sync?.cache(); sync?.notify('Guardado en este equipo; pendiente de sincronizar.', 'pending'); return; } await sync?.flush(); syncControls(); });
  for (const id of ['review-grade', 'review-feedback', 'correction-due']) $('#' + id).oninput = () => { reviewDirty = true; $('#review-state').textContent = 'Revisión sin guardar'; };
  $('#reload-review').onclick = () => perform(async () => { if (opened) await openAnswer(opened.assignment.id, reviewedStudent); });
  $('#review-form').onsubmit = event => { event.preventDefault(); const action = event.submitter?.value || 'review'; perform(async () => {
    if (!opened || profile.role !== 'teacher') return;
    const gradeValue = $('#review-grade').value.trim(), due = $('#correction-due').value;
    if (action === 'return' && !confirm('¿Devolver esta entrega para correcciones? El alumno podrá editarla hasta el nuevo plazo.')) return;
    const id = opened.assignment.id, studentId = reviewedStudent;
    await api('answer-review', { assignmentId: id, studentId, revision: opened.revision, action, grade: gradeValue === '' ? null : Number(gradeValue), feedback: $('#review-feedback').value, correctionDueAt: due ? new Date(due).toISOString() : null });
    reviewDirty = false; await openAnswer(id, studentId, true); await showProgress(id, true); await refresh(); notice(action === 'return' ? 'Entrega devuelta. El alumno ya puede corregirla dentro de su nuevo plazo.' : 'Calificación y comentarios guardados. El alumno ya puede verlos.');
  }); };
  $('#reload-answer').onclick = () => perform(async () => { if (!opened || !confirm('¿Cargar la versión del servidor? Se descartarán los cambios locales de esta actividad.')) return; await openAnswer(opened.assignment.id, null, true, true); });
  $('#submit-answer').onclick = () => perform(async () => {
    if (!online()) throw new Error('Conecta Internet para confirmar la entrega. Tu avance se conserva en este equipo.');
    if (!sync || !confirm('¿Entregar la actividad? Tu respuesta quedará en modo de solo lectura.')) return;
    worksheet.setReadonly(true);
    try { await sync.flush(true); opened.writable = false; $('#work-readonly').hidden = false; await refresh(); await openAnswer(opened.assignment.id, null, true); }
    catch (error) { worksheet.setReadonly(!opened.writable || sync.blocked); throw error; }
    finally { syncControls(); }
  });
  $('#close-work').onclick = () => navigation.back();
  $('#close-progress').onclick = () => navigation.back();
  window.addEventListener('beforeunload', event => { if (sync?.dirty || draftDirty || reviewDirty) { event.preventDefault(); event.returnValue = ''; } });
  for (const eventName of ['copy', 'cut', 'paste', 'drop']) document.addEventListener(eventName, event => { if (profile?.role === 'student' && !profile.must_change_password) event.preventDefault(); }, true);
  document.addEventListener('beforeinput', event => { if (profile?.role === 'student' && !profile.must_change_password && ['insertFromPaste', 'insertFromDrop'].includes(event.inputType)) event.preventDefault(); }, true);
  return {
    current: () => opened ? { assignmentId: opened.assignment.id, sync, writable: opened.writable } : null,
    syncControls,
    canReload: canLeave,
    async setSession(value) {
      const nextKey = value ? value.id + ':' + value.must_change_password : '';
      if (nextKey !== sessionKey) {
        teardown(); progressId = null; progressTokens.clear(); progressBudget.reset(); $('#progress-list').replaceChildren(); $('#activity-progress').hidden = true; $('#activity-drafts').replaceChildren(); $('#assignments-list').replaceChildren(); sessionKey = nextKey;
        view = value?.role === 'student' ? 'activities' : 'roster';
        const home = view;
        navigation.reset(nextKey, { key: home, restore: () => showSection(home) });
      }
      profile = value; $('#activity-teacher-tools').hidden = profile?.role !== 'teacher';
      if (profile?.role === 'teacher') $('#teacher-panel').hidden = profile.must_change_password || view === 'activities';
      $('#activities-hub').hidden = !profile || profile.must_change_password || (profile.role === 'teacher' && view === 'roster');
      $('#activities-heading').textContent = profile?.role === 'teacher' ? 'Actividades y avances' : 'Mis actividades';
      syncControls();
      if (profile && !profile.must_change_password && (profile.role === 'student' || view === 'activities')) await refresh();
    },
  };
}
