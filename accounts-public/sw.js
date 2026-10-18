importScripts('/shell-assets.js');
const CACHE = 'aula-shell-' + self.AULA_SHELL.version;
const paths = new Set(self.AULA_SHELL.assets);
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(self.AULA_SHELL.assets.map(path => new Request(path, { cache: 'reload', credentials: 'omit' })));
  // Se activa al cerrar las pestañas anteriores: no recarga ediciones abiertas.
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('aula-shell-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith((async () => { const cache = await caches.open(CACHE); return await cache.match('/') || fetch(event.request); })()); return;
  }
  if (paths.has(url.pathname) && !url.search) event.respondWith((async () => (await caches.open(CACHE)).match(url.pathname).then(response => response || fetch(event.request)))());
});
