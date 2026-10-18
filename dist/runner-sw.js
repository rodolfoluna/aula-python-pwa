const SHELL = 'aula-runner-shell-__RUNNER_VERSION__', PYTHON = 'aula-python-0.27.7-matplotlib-v1';
const shell = ['/runner.html', '/runner.js', '/runner.css', '/python-worker.js', '/runtime-assets.json'];
let preparing;
self.addEventListener('install', event => event.waitUntil((async () => { await (await caches.open(SHELL)).addAll(shell); })()));
self.addEventListener('activate', event => event.waitUntil((async () => { for (const key of await caches.keys()) if (key.startsWith('aula-runner-shell-') && key !== SHELL) await caches.delete(key); await self.clients.claim(); })()));
async function runtimeManifest() { return (await (await caches.open(SHELL)).match('/runtime-assets.json')).json(); }
async function prepare(port) {
  const manifest = await runtimeManifest(), cache = await caches.open(PYTHON); let done = 0;
  for (const asset of manifest.assets) {
    if (!await cache.match(asset.url)) {
      const response = await fetch(asset.url, { mode: 'cors', credentials: 'omit', cache: 'no-cache' });
      if (!response.ok || response.type === 'opaque') throw new Error('No se pudo descargar un archivo de Python.');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer()))].map(byte => byte.toString(16).padStart(2,'0')).join('');
      if (digest !== asset.sha256) throw new Error('La descarga de Python no pasó la comprobación de integridad. Reintenta la preparación.');
      await cache.put(asset.url, response);
    }
    port.postMessage({ progress: true, done: ++done, total: manifest.assets.length });
  }
  return { ready: true, total: done };
}
self.addEventListener('message', event => {
  if (event.data?.type !== 'prepare-python' || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil((async () => {
    try { if (preparing) await preparing; preparing = prepare(port); port.postMessage(await preparing); }
    catch (error) { port.postMessage({ error: error.message }); }
    finally { preparing = null; }
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin === self.location.origin && shell.includes(url.pathname)) {
    // La consulta parent cambia por aula; la página es idéntica y conserva COOP/COEP.
    event.respondWith((async () => (await caches.open(SHELL)).match(url.pathname).then(value => value || fetch(event.request)))()); return;
  }
  if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/pyodide/v0.27.7/full/')) event.respondWith((async () => {
    const manifest = await runtimeManifest();
    if (!manifest.assets.some(asset => asset.url === url.href)) return fetch(event.request);
    return await (await caches.open(PYTHON)).match(url.href) || fetch(event.request);
  })());
});
