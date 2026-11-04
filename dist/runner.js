const parentOrigin = new URL(new URLSearchParams(location.search).get('parent') || 'http://127.0.0.1:4180').origin;
const $ = selector => document.querySelector(selector);
// Keep the theme in a versioned asset: a CDN may retain the original runner.css.
if (!document.querySelector('link[href="/runner-theme-v1.css"]')) {
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = '/runner-theme-v1.css'; document.head.append(stylesheet);
}
const tell = (type, data = {}) => parent.postMessage({ type, ...data }, parentOrigin);
let serviceWorkerReady;
async function offlineWorker() {
  if (!navigator.serviceWorker) throw new Error('El navegador no permite preparar Python sin conexión en este contexto.');
  return serviceWorkerReady ||= navigator.serviceWorker.register('/runner-sw.js', { updateViaCache: 'none' }).then(() => navigator.serviceWorker.ready);
}
if (typeof navigator !== 'undefined' && navigator.serviceWorker) offlineWorker().catch(() => {});
let worker, loaded, control, inputBytes, interrupt, busy = false, student = true, output, pending, sequence = 0, timeout, killTimer, stopped = false;
function status(text) { $('#state').textContent = text; }
function append(channel, text) {
  if (!output) return;
  const last = output.lastElementChild;
  if (last?.tagName === 'PRE' && last.className === channel) last.textContent += text;
  else { const pre = document.createElement('pre'); pre.className = channel; pre.textContent = text; output.append(pre); }
}
function destroy() { worker?.terminate(); worker = null; loaded?.reject(new Error('Memoria reiniciada.')); loaded = null; pending?.resolve(false); pending = null; clearTimeout(timeout); clearTimeout(killTimer); $('#input-form').hidden = true; }
function timer() { clearTimeout(timeout); timeout = setTimeout(() => stop('Se superaron 30 segundos de ejecución.'), 30000); }
async function initialize() {
  if (worker) return loaded.promise;
  if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') throw new Error('El navegador no habilitó el aislamiento de Python. En la versión publicada, usa HTTPS y comprueba las cabeceras de aislamiento de ambos servicios. En local, usa 127.0.0.1 e inicia npm run dev.');
  const input = new SharedArrayBuffer(65544); control = new Int32Array(input, 0, 2); inputBytes = new Uint8Array(input, 8); interrupt = new Uint8Array(new SharedArrayBuffer(1));
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); loaded = { promise, resolve, reject };
  worker = new Worker('/python-worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'status') { status(data.text); if (data.loading === true) clearTimeout(timeout); else if (data.loading === false && busy) timer(); }
    if (data.type === 'diagnostic') $('#diagnostics').textContent += data.text + '\n';
    if (data.type === 'ready') loaded.resolve();
    if (data.type === 'text') append(data.channel, data.text);
    if (data.type === 'figure') { const img = document.createElement('img'); img.src = 'data:image/png;base64,' + data.data; img.alt = 'Gráfica de Python'; output?.append(img); }
    if (data.type === 'input') { clearTimeout(timeout); $('#input-form').hidden = false; $('#input').value = ''; $('#input').focus(); status('Esperando tu respuesta…'); }
    if (data.type === 'done') { clearTimeout(timeout); clearTimeout(killTimer); $('#input-form').hidden = true; pending?.resolve(data.ok); pending = null; }
    if (data.type === 'fatal') { append('stderr', data.text); loaded?.reject(new Error(data.text)); destroy(); }
  };
  worker.onerror = event => { append('stderr', event.message); destroy(); };
  worker.postMessage({ type: 'init', input, interrupt: interrupt.buffer });
  const limit = setTimeout(() => destroy(), 120000);
  try { await promise; } finally { clearTimeout(limit); }
}
async function execute(item) {
  const section = document.createElement('section'); section.className = 'run-output'; const title = document.createElement('strong'); title.textContent = item.label || 'Resultado'; section.append(title); $('#outputs').append(section); output = section;
  interrupt[0] = 0; timer();
  const id = ++sequence; return new Promise(resolve => { pending = { resolve }; worker.postMessage({ type: 'run', id, ...item.payload }); });
}
function stop(message = 'Ejecución detenida.') {
  if (!busy) return; stopped = true; append('stderr', message + '\n');
  if (!interrupt) { destroy(); return; }
  interrupt[0] = 2; Atomics.notify(control, 0); $('#input-form').hidden = true;
  killTimer = setTimeout(destroy, 1500);
}
window.addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== parentOrigin) return;
  if (event.data?.type === 'aula-prepare-offline') {
    try {
      const registration = await offlineWorker(), channel = new MessageChannel();
      channel.port1.onmessage = ({ data }) => { tell('aula-offline-progress', data); if (data.ready || data.error) channel.port1.close(); };
      registration.active.postMessage({ type: 'prepare-python' }, [channel.port2]);
    } catch (error) { tell('aula-offline-progress', { error: error.message }); }
    return;
  }
  if (event.data?.type === 'aula-theme' || event.data?.type === 'aula-config') {
    document.documentElement.dataset.theme = event.data.theme === 'dark' ? 'dark' : 'light';
    if (event.data.type === 'aula-config') student = event.data.student !== false;
    return;
  }
  if (event.data?.type !== 'aula-run' || busy || !Array.isArray(event.data.items) || event.data.items.length > 100) return;
  busy = true; stopped = false; status('Preparando ejecución…'); tell('aula-busy', { busy: true }); $('#stop').disabled = false; $('#reset').disabled = true;
  try {
    await initialize(); let ok = true;
    for (const item of event.data.items) { if (stopped || !await execute(item)) { ok = false; break; } }
    status(ok ? 'Ejecución completada' : 'Ejecución detenida o con error · Revisa la salida');
  } catch (error) { const pre = document.createElement('pre'); pre.className = 'stderr'; pre.textContent = error.message; $('#outputs').append(pre); status('No se pudo iniciar Python'); }
  finally { busy = false; $('#stop').disabled = true; $('#reset').disabled = false; tell('aula-busy', { busy: false }); }
});
$('#stop').onclick = () => stop(); $('#reset').onclick = () => { if (!busy) { destroy(); status('Memoria reiniciada. Las salidas anteriores se conservan.'); } };
$('#input-form').onsubmit = event => { event.preventDefault(); const bytes = new TextEncoder().encode($('#input').value); if (bytes.length > 65536) { status('La entrada supera 64 KB'); return; } inputBytes.set(bytes); Atomics.store(control, 1, bytes.length); append('stdin', $('#input').value + '\n'); $('#input-form').hidden = true; Atomics.store(control, 0, 1); Atomics.notify(control, 0); timer(); };
for (const type of ['copy', 'cut', 'paste', 'drop']) document.addEventListener(type, event => { if (student) event.preventDefault(); }, true);
window.addEventListener('pagehide', destroy);
tell('aula-ready');
