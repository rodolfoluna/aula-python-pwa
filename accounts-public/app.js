import { previewCsv, credentialsCsv } from './csv.js';
import { setupActivities } from './activities.js';
const $ = selector => document.querySelector(selector);
let profile, roster = { students: [], groups: [], memberships: [] }, preview = [], credentials = [], busy = false, configured = false;
let activities, runnerOrigin = 'http://127.0.0.1:4173';
function message(text, error = false) { $('#message').textContent = text; $('#message').classList.toggle('error', error); $('#message').hidden = !text; }
async function api(path, data) {
  const response = await fetch('/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !['login', 'password'].includes(path)) { profile = null; credentials = []; $('#credentials-table').replaceChildren(); $('#credentials-dialog').close(); await renderSession(); }
    throw Object.assign(new Error(result.error || 'No se pudo completar la solicitud.'), { status: response.status });
  }
  return result;
}
function syncControls() {
  document.querySelectorAll('button, input, select').forEach(element => { element.disabled = busy; });
  $('#login-submit').disabled = busy || !configured;
  $('#confirm-csv').disabled = busy || !preview.some(row => row.valid);
  document.querySelectorAll('[data-membership]').forEach(input => { input.disabled = busy || !$('#roster-group').value; });
  if (!busy) activities?.syncControls();
}
async function perform(action) {
  if (busy) return;
  busy = true; syncControls(); message('');
  try { await action(); } catch (error) { message(error.message, true); }
  finally { busy = false; syncControls(); }
}
function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderGroups() {
  for (const id of ['student-group', 'csv-group', 'roster-group']) {
    const select = $('#' + id), previous = select.value; select.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = id === 'roster-group' ? 'Selecciona un grupo para administrar' : 'Sin grupo inicial'; select.append(empty);
    for (const group of roster.groups) { const option = document.createElement('option'); option.value = group.id; option.textContent = group.name; select.append(option); }
    if (roster.groups.some(group => group.id === previous)) select.value = previous;
  }
}
function cell(row, text) { const td = document.createElement('td'); td.textContent = text; row.append(td); return td; }
function renderStudents() {
  const search = $('#student-search').value.trim().toLocaleLowerCase('es'), groupId = $('#roster-group').value;
  const students = roster.students.filter(student => (student.control + ' ' + student.name).toLocaleLowerCase('es').includes(search));
  $('#students-table').replaceChildren();
  for (const student of students) {
    const row = document.createElement('tr'), memberCell = document.createElement('td'), member = document.createElement('input');
    member.type = 'checkbox'; member.dataset.membership = student.id; member.setAttribute('aria-label', `Agregar o quitar a ${student.name} del grupo seleccionado`);
    member.checked = roster.memberships.some(item => item.group_id === groupId && item.student_id === student.id);
    member.onchange = () => perform(async () => { try { await api('membership', { groupId, studentId: student.id, member: member.checked }); } catch (error) { member.checked = !member.checked; throw error; } await loadRoster(); });
    memberCell.append(member); row.append(memberCell); cell(row, student.control); cell(row, student.name);
    const groupsCell = document.createElement('td');
    for (const membership of roster.memberships.filter(item => item.student_id === student.id)) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = roster.groups.find(group => group.id === membership.group_id)?.name || ''; groupsCell.append(tag); }
    row.append(groupsCell); cell(row, !student.active ? 'Desactivado' : student.must_change_password ? 'Debe cambiar clave' : 'Listo');
    const actions = document.createElement('td'), reset = document.createElement('button'), active = document.createElement('button');
    reset.textContent = 'Restablecer clave'; reset.onclick = () => { if (!confirm(`¿Generar una nueva clave temporal para ${student.name}? Se cerrarán sus sesiones.`)) return; perform(async () => { const result = await api('reset-password', { studentId: student.id }); await showCredentials([result.credential]); }); };
    active.textContent = student.active ? 'Desactivar' : 'Reactivar'; active.onclick = () => { if (!confirm(`¿${student.active ? 'Desactivar' : 'Reactivar'} la cuenta de ${student.name}?`)) return; perform(async () => { await api('student-active', { studentId: student.id, active: !student.active }); await loadRoster(); }); };
    actions.append(reset, active); row.append(actions); $('#students-table').append(row);
  }
  $('#roster-empty').hidden = students.length > 0;
  $('#roster-empty').textContent = roster.students.length ? 'No hay alumnos que coincidan con la búsqueda.' : 'Todavía no hay alumnos registrados.';
  $('#student-count').textContent = roster.students.length; $('#group-count').textContent = roster.groups.length;
  $('#pending-count').textContent = roster.students.filter(student => student.active && student.must_change_password).length;
  syncControls();
}
async function loadRoster() { roster = await api('roster'); renderGroups(); renderStudents(); }
async function showCredentials(records, rejected = []) {
  credentials = records; $('#credentials-table').replaceChildren(); $('#creation-warnings').replaceChildren();
  for (const record of records) { const row = document.createElement('tr'); cell(row, record.control); cell(row, record.name); cell(row, record.password); $('#credentials-table').append(row); if (record.warning) { const item = document.createElement('li'); item.textContent = record.warning; $('#creation-warnings').append(item); } }
  for (const failure of rejected) { const item = document.createElement('li'); item.textContent = `${failure.control}: ${failure.message}`; $('#creation-warnings').append(item); }
  // Mostrar claves antes de refrescar: un fallo posterior de red no debe ocultarlas.
  if (records.length) $('#credentials-dialog').showModal();
  else message(rejected.map(item => item.control + ': ' + item.message).join(' · ') || 'No se crearon cuentas.', true);
  await loadRoster();
}
async function renderSession() {
  $('#login-panel').hidden = !!profile; $('#session-tools').hidden = !profile;
  $('#password-panel').hidden = !profile?.must_change_password;
  $('#teacher-panel').hidden = !profile || profile.must_change_password || profile.role !== 'teacher';
  $('#student-panel').hidden = !profile || profile.must_change_password || profile.role !== 'student';
  $('#session-name').textContent = profile?.name || '';
  if (profile && !profile.must_change_password) {
    if (profile.role === 'teacher') await loadRoster();
    else {
      $('#student-welcome').textContent = `Hola, ${profile.name}`; $('#my-groups').replaceChildren();
      const { groups } = await api('my-groups');
      for (const group of groups) { const li = document.createElement('li'); li.textContent = group.name; $('#my-groups').append(li); }
      if (!groups.length) { const li = document.createElement('li'); li.textContent = 'Tu profesor todavía no te ha agregado a un grupo.'; $('#my-groups').append(li); }
    }
  }
  await activities?.setSession(profile);
}
$('#login-form').onsubmit = event => { event.preventDefault(); perform(async () => { const result = await api('login', { login: $('#login').value, password: $('#password').value }); $('#password').value = ''; profile = result.profile; await renderSession(); }); };
$('#password-form').onsubmit = event => { event.preventDefault(); perform(async () => {
  if ($('#new-password').value !== $('#repeat-password').value) throw new Error('Las nuevas contraseñas no coinciden.');
  await api('password', { currentPassword: $('#current-password').value, password: $('#new-password').value }); $('#password-form').reset(); profile = (await api('me')).profile; await renderSession(); message('Contraseña actualizada. Tu cuenta ya está lista.');
}); };
$('#logout').onclick = () => perform(async () => { await api('logout', {}); profile = null; credentials = []; preview = []; roster = { students: [], groups: [], memberships: [] }; $('#students-table').replaceChildren(); $('#my-groups').replaceChildren(); $('#credentials-table').replaceChildren(); $('#csv-preview').replaceChildren(); $('#csv-preview-panel').hidden = true; $('#csv-summary').textContent = 'Vista previa antes de crear las cuentas.'; $('#student-search').value = ''; await renderSession(); });
$('#student-form').onsubmit = event => { event.preventDefault(); perform(async () => { const result = await api('students', { rows: [{ control: $('#student-control').value, name: $('#student-name').value }], groupId: $('#student-group').value || null }); if (result.created.length) $('#student-form').reset(); await showCredentials(result.created, result.rejected); }); };
$('#group-form').onsubmit = event => { event.preventDefault(); perform(async () => { await api('groups', { name: $('#group-name').value }); $('#group-form').reset(); await loadRoster(); message('Grupo creado. Selecciónalo en la lista de alumnos para agregar integrantes.'); }); };
$('#csv-file').onchange = event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; perform(async () => {
  preview = []; $('#csv-preview').replaceChildren(); $('#csv-preview-panel').hidden = true;
  if (file.size > 1024 * 1024) throw new Error('El CSV supera 1 MB.');
  preview = previewCsv(await file.text(), roster.students.map(student => student.control));
  for (const record of preview) { const row = document.createElement('tr'); cell(row, record.line); cell(row, record.control); cell(row, record.name); cell(row, record.valid ? 'Listo para crear' : record.error).className = record.valid ? 'valid' : 'invalid'; $('#csv-preview').append(row); }
  $('#csv-preview-panel').hidden = false; $('#csv-summary').textContent = `${preview.filter(row => row.valid).length} alumnos válidos · ${preview.filter(row => !row.valid).length} registros por revisar.`;
}); };
$('#confirm-csv').onclick = () => perform(async () => { const rows = preview.filter(row => row.valid).map(({ control, name }) => ({ control, name })); if (!rows.length) return; const result = await api('students', { rows, groupId: $('#csv-group').value || null }); preview = []; $('#csv-preview-panel').hidden = true; $('#csv-summary').textContent = `${result.created.length} cuentas creadas · ${result.rejected.length} no creadas.`; await showCredentials(result.created, result.rejected); });
$('#download-credentials').onclick = () => download(credentialsCsv(credentials), 'claves-temporales.csv');
$('#close-credentials').onclick = () => { credentials = []; $('#credentials-table').replaceChildren(); $('#credentials-dialog').close(); };
$('#credentials-dialog').addEventListener('cancel', event => { event.preventDefault(); message('Guarda las claves y pulsa «Ya guardé las claves» para cerrar.'); });
$('#csv-example').onclick = () => download('\uFEFFnumero_control,nombre\r\n00123456,Ana López\r\n00123457,Luis Pérez\r\n', 'alumnos-plantilla.csv');
$('#student-search').oninput = renderStudents; $('#roster-group').onchange = renderStudents;
$('#refresh-roster').onclick = () => perform(loadRoster);
window.addEventListener('beforeunload', event => { if (credentials.length) { event.preventDefault(); event.returnValue = ''; } });
activities = setupActivities({ api, perform, getGroups: () => roster.groups, getProfile: () => profile, getRunnerOrigin: () => runnerOrigin });
await perform(async () => {
  const status = await api('status'); configured = status.configured; runnerOrigin = status.runnerOrigin || runnerOrigin;
  $('#local-lab-link').hidden = new URL(runnerOrigin).protocol === 'https:';
  $('#setup-note').hidden = configured; $('#setup-note').textContent = configured ? '' : 'Falta conectar Supabase. Completa .env y sigue SUPABASE_SETUP.md; después reinicia npm run accounts.';
  if (configured) { try { profile = (await api('me')).profile; } catch { profile = null; } }
  await renderSession();
});
