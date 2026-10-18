import { STORAGE_KEY, INPUT_CAPACITY, initialState, restoreState, validFilename, encodeInput } from './model.js';
import { setupNotebookEditor } from './notebook-editor.js';
import { bindCodeEditor } from './code-editor.js';
const $ = selector => document.querySelector(selector);
let state;
try { state = restoreState(localStorage.getItem(STORAGE_KEY)); } catch { state = initialState(); }
let mode = 'notebook', busy = false, sequence = 0, currentOutput, lastText = '';
let worker, ready, isReady = false, inputControl, inputBytes, interrupt;
let pending = new Map(), stopTimer, runTimer, stopRequested = false;
let notebookEditor;
let runFailed = false;

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); $('#save-state').textContent = '✓ Guardado en este navegador'; }
  catch { $('#save-state').textContent = 'No se pudo guardar: descarga o copia tu código antes de cerrar.'; }
}
function runtime(text, status = '') { $('#runtime-state').textContent = text; $('#runtime-dot').className = 'runtime-dot ' + status; }
function setBusy(value) {
  busy = value;
  document.querySelectorAll('.run-cell, #run-all, #run-files, #reset-runtime, #add-cell, #add-file, #delete-file, #entry-file, .code-editor, .nav, .file-tab').forEach(el => { el.disabled = value; });
  $('#stop').disabled = !value;
  if (!value) $('#delete-file').disabled = Object.keys(state.files).length === 1;
  if (!value) { clearTimeout(runTimer); clearTimeout(stopTimer); $('#input-dock').hidden = true; }
  notebookEditor?.syncBusy();
}
function appendText(channel, text) {
  if (!currentOutput) return;
  lastText = (lastText + text).slice(-500);
  const previous = currentOutput.lastElementChild;
  if (previous?.tagName === 'PRE' && previous.className === channel) previous.textContent += text;
  else { const pre = document.createElement('pre'); pre.className = channel; pre.textContent = text; currentOutput.append(pre); }
}
function destroyRuntime(reason) {
  clearTimeout(stopTimer); clearTimeout(runTimer);
  worker?.terminate(); worker = undefined; isReady = false;
  for (const callbacks of pending.values()) callbacks.resolve(false);
  pending.clear();
  ready?.reject(new Error(reason)); ready = undefined;
  $('#input-dock').hidden = true;
}
function ensureRuntime() {
  if (worker) return ready.promise;
  if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') return Promise.reject(new Error('Abre esta prueba con npm run dev en localhost. Faltan las cabeceras necesarias para input().'));
  let resolveReady, rejectReady;
  const promise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready = { promise, resolve: resolveReady, reject: rejectReady };
  const input = new SharedArrayBuffer(INPUT_CAPACITY + 8);
  inputControl = new Int32Array(input, 0, 2); inputBytes = new Uint8Array(input, 8);
  interrupt = new Uint8Array(new SharedArrayBuffer(1));
  worker = new Worker('/python-worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'status') runtime(data.text, 'busy');
    if (data.type === 'diagnostic') $('#runtime-log').textContent += data.text + (data.text.endsWith('\n') ? '' : '\n');
    if (data.type === 'ready') { isReady = true; runtime('Python listo', 'ready'); $('#runtime-hint').textContent = 'Sesión local · Variables compartidas'; ready.resolve(); }
    if (data.type === 'text') appendText(data.channel, data.text);
    if (data.type === 'figure' && currentOutput) { const img = document.createElement('img'); img.alt = 'Gráfica generada con Python'; img.src = 'data:image/png;base64,' + data.data; currentOutput.append(img); }
    if (data.type === 'input') {
      clearTimeout(runTimer);
      $('#input-prompt').textContent = lastText.trim().split('\n').at(-1) || 'Escribe el valor para input()';
      $('#input-dock').hidden = false; $('#stdin').value = ''; $('#stdin').focus(); runtime('Esperando tu respuesta…', 'busy');
    }
    if (data.type === 'done') {
      clearTimeout(runTimer); clearTimeout(stopTimer); $('#input-dock').hidden = true;
      if (!data.ok) {
        runFailed = true;
        if (currentOutput) {
          currentOutput.classList.add('has-error');
          const help = document.createElement('p'); help.className = 'execution-error-help';
          help.textContent = /NameError/.test(currentOutput.textContent) ? 'Falta una variable en esta sesión. Ejecuta primero las celdas anteriores o pulsa «Ejecutar todas».' : 'La celda terminó con un error. El detalle permanece visible hasta que vuelvas a ejecutarla.';
          currentOutput.append(help);
        }
      }
      pending.get(data.id)?.resolve(data.ok); pending.delete(data.id);
    }
    if (data.type === 'fatal') { runFailed = true; appendText('stderr', data.text + '\n'); destroyRuntime(data.text); runtime('Error al iniciar Python. Reinicia para reintentar.'); }
  };
  worker.onerror = event => { runFailed = true; appendText('stderr', event.message + '\n'); destroyRuntime(event.message); runtime('Error de ejecución. Reinicia Python.'); };
  worker.postMessage({ type: 'init', input, interrupt: interrupt.buffer });
  return promise;
}
function armTimeout() {
  clearTimeout(runTimer);
  runTimer = setTimeout(() => stopExecution('Se superó el límite de 30 segundos de ejecución.'), 30000);
}
function execute(payload, output) {
  currentOutput = output; lastText = ''; output.replaceChildren(); output.classList.remove('has-error');
  interrupt[0] = 0;
  const id = ++sequence;
  runtime('Ejecutando Python…', 'busy');
  armTimeout();
  return new Promise(resolve => { pending.set(id, { resolve }); worker.postMessage({ type: 'run', id, ...payload }); });
}
async function runTask(task) {
  if (busy) return;
  setBusy(true); stopRequested = false; runFailed = false;
  const startupTimeout = setTimeout(() => { appendText('stderr', 'La descarga tardó más de dos minutos. Revisa tu conexión y reintenta.\n'); destroyRuntime('Tiempo de carga agotado.'); }, 120000);
  try { await ensureRuntime(); clearTimeout(startupTimeout); if (!stopRequested) await task(); }
  catch (error) { runFailed = true; appendText('stderr', error.message + '\n'); runtime(isReady ? 'La ejecución terminó con un error. Revisa la salida.' : 'No se pudo iniciar Python. Revisa la conexión.'); }
  finally { clearTimeout(startupTimeout); setBusy(false); if (isReady) runtime(runFailed ? 'Ejecución con error · Revisa la salida de la celda' : 'Python listo', runFailed ? 'error' : 'ready'); }
}
function stopExecution(message = 'Ejecución detenida por el usuario.') {
  if (!busy || stopRequested) return;
  stopRequested = true;
  appendText('stderr', message + '\n');
  $('#input-dock').hidden = true;
  if (!isReady) { destroyRuntime(message); runtime('Carga detenida. Puedes reintentar.'); return; }
  interrupt[0] = 2;
  Atomics.notify(inputControl, 0);
  runtime('Deteniendo…', 'busy');
  stopTimer = setTimeout(() => { destroyRuntime(message); runtime('Python detenido. Se reiniciará al ejecutar.'); }, 1500);
}
function editorBehavior(editor, onChange) {
  bindCodeEditor(editor, onChange, save);
}
function renderFiles() {
  $('#file-tabs').replaceChildren(); $('#entry-file').replaceChildren();
  for (const name of Object.keys(state.files)) {
    const button = document.createElement('button'); button.className = 'file-tab'; button.textContent = name; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(name === state.activeFile));
    button.onclick = () => { state.activeFile = name; renderFiles(); save(); };
    $('#file-tabs').append(button);
    const option = document.createElement('option'); option.value = name; option.textContent = name; $('#entry-file').append(option);
  }
  $('#entry-file').value = state.entry; $('#file-editor').value = state.files[state.activeFile];
  $('#file-editor').setAttribute('aria-label', `Código de ${state.activeFile}`);
  $('#delete-file').disabled = Object.keys(state.files).length === 1;
}
function changeMode(value) {
  if (busy) return;
  if (mode !== value && worker) { destroyRuntime('Cambio de espacio de trabajo.'); runtime('Python sin iniciar'); }
  mode = value;
  $('#notebook-panel').hidden = mode !== 'notebook'; $('#files-panel').hidden = mode !== 'files';
  $('#nav-notebook').classList.toggle('active', mode === 'notebook'); $('#nav-files').classList.toggle('active', mode === 'files');
  $('#nav-notebook').setAttribute('aria-pressed', String(mode === 'notebook')); $('#nav-files').setAttribute('aria-pressed', String(mode === 'files'));
  $('#page-title').textContent = mode === 'notebook' ? 'Un cuaderno, muchas ideas.' : 'Conecta tus archivos.';
  $('#page-description').textContent = mode === 'notebook' ? 'Ejecuta las celdas en orden: comparten variables, funciones y objetos.' : 'Escribe, importa y ejecuta un programa con varios módulos de Python.';
  currentOutput = undefined;
}
$('#nav-notebook').onclick = () => changeMode('notebook'); $('#nav-files').onclick = () => changeMode('files');
$('#run-files').onclick = () => { currentOutput = $('#file-output'); runTask(() => execute({ mode: 'files', files: { ...state.files }, entry: state.entry }, $('#file-output'))); };
$('#stop').onclick = () => stopExecution();
$('#reset-runtime').onclick = () => { destroyRuntime('Sesión reiniciada.'); runtime('Memoria reiniciada. Ejecuta para iniciar.'); document.querySelectorAll('.cell-state').forEach(el => { el.textContent = 'Volver a ejecutar'; }); };
editorBehavior($('#file-editor'), value => { state.files[state.activeFile] = value; });
$('#entry-file').onchange = event => { state.entry = event.target.value; save(); };
$('#add-file').onclick = () => { $('#filename').value = ''; $('#file-error').textContent = ''; $('#file-dialog').showModal(); $('#filename').focus(); };
$('#cancel-file').onclick = () => $('#file-dialog').close();
$('#file-form').onsubmit = event => { event.preventDefault(); const name = $('#filename').value.trim(); if (!validFilename(name) || Object.hasOwn(state.files, name)) { $('#file-error').textContent = 'El nombre no es válido o ya existe.'; return; } state.files[name] = ''; state.activeFile = name; renderFiles(); save(); $('#file-dialog').close(); $('#file-editor').focus(); };
$('#delete-file').onclick = () => { if (Object.keys(state.files).length < 2 || !confirm(`¿Eliminar ${state.activeFile}? Esta prueba no tiene papelera.`)) return; delete state.files[state.activeFile]; state.activeFile = Object.keys(state.files)[0]; if (!Object.hasOwn(state.files, state.entry)) state.entry = state.activeFile; renderFiles(); save(); };
$('#input-form').onsubmit = event => {
  event.preventDefault();
  try { const text = $('#stdin').value, bytes = encodeInput(text); inputBytes.set(bytes); Atomics.store(inputControl, 1, bytes.length); appendText('input-echo', text + '\n'); $('#input-dock').hidden = true; Atomics.store(inputControl, 0, 1); Atomics.notify(inputControl, 0); runtime('Ejecutando Python…', 'busy'); armTimeout(); }
  catch (error) { $('#input-prompt').textContent = error.message; }
};
notebookEditor = setupNotebookEditor({ state, save, isBusy: () => busy, invalidateRuntime: () => { destroyRuntime('Notebook actualizado.'); runtime('Memoria reiniciada. Vuelve a ejecutar las celdas.'); }, runTask, execute, setCurrentOutput: output => { currentOutput = output; }, editorBehavior });
renderFiles();
if (!crossOriginIsolated) runtime('Abre con npm run dev: input() necesita aislamiento del navegador.');
