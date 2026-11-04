import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { hostingConfig } from '../accounts/hosting.mjs';
import { createAccountsServer } from '../accounts/server.mjs';
import { memoryAccountStore } from './helpers/account-store.mjs';

test('publicación exige HTTPS, orígenes separados y puerto del alojamiento', () => {
  assert.equal(hostingConfig({}).host, '127.0.0.1');
  const env = { NODE_ENV: 'production', PORT: '10000', RENDER_EXTERNAL_URL: 'https://aula.example', RUNNER_HOSTNAME: 'python.example' };
  assert.deepEqual(hostingConfig(env), { port: 10000, host: '0.0.0.0', secure: true, origin: 'https://aula.example', runnerOrigin: 'https://python.example' });
  for (const patch of [{ RUNNER_ORIGIN: 'https://aula.example' }, { RUNNER_ORIGIN: 'http://python.example' }, { APP_ORIGIN: 'https://aula.example/path' }, { APP_ORIGIN: 'https://secret@aula.example' }, { APP_ORIGIN: 'https://127.0.0.1' }, { PORT: '0' }, { PORT: 'NaN' }]) assert.throws(() => hostingConfig({ ...env, ...patch }));
  assert.throws(() => hostingConfig({ NODE_ENV: 'production' }), /Configura/);
});

test('HTTPS publicado: cookie segura, CSRF por origen, cabeceras y secretos inaccesibles', async () => {
  const store = memoryAccountStore();
  await store.createUser({ email: 'teacher@example.com', password: 'PruebaSegura1234', name: 'Profesor', role: 'teacher' });
  const server = createAccountsServer({ store, secure: true, origin: 'https://aula.example', runnerOrigin: 'https://python.example' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base);
    assert.match(page.headers.get('permissions-policy'), /https:\/\/python.example/);
    assert.match(page.headers.get('content-security-policy'), /frame-src https:\/\/python.example;/);
    assert.equal(page.headers.get('cross-origin-embedder-policy'), 'require-corp');
    const html = await page.text(), nonce = html.match(/name="style-nonce" content="([^"]+)"/)[1];
    assert.ok(page.headers.get('content-security-policy').includes(`'nonce-${nonce}'`));
    assert.ok(!page.headers.get('content-security-policy').includes('unsafe-inline'));
    for (const path of ['/navigation.js', '/code-editor.js', '/vendor/code-editor.js']) assert.equal((await fetch(base + path)).status, 200);
    const login = origin => fetch(base + '/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'teacher@example.com', password: 'PruebaSegura1234' }) });
    assert.equal((await login('https://python.example')).status, 403);
    const response = await login('https://aula.example'); assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /; Secure/);
    for (const path of ['/.env', '/render.yaml', '/accounts/server.mjs', '/python-worker.js']) assert.equal((await fetch(base + path)).status, 404);
    assert.deepEqual(await (await fetch(base + '/healthz')).json(), { ok: true });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('consola publicable contiene solo los archivos del ejecutor, sin cuentas ni configuración', async () => {
  await import('../scripts/build-runner.mjs');
  const files = await readdir(new URL('../build/runner/', import.meta.url));
  assert.deepEqual(files.sort(), ['index.html', 'python-worker.js', 'runner-sw.js', 'runner-theme-v1.css', 'runner.css', 'runner.html', 'runner.js', 'runtime-assets.json']);
  assert.equal(await readFile(new URL('../build/runner/runner.js', import.meta.url), 'utf8'), await readFile(new URL('../dist/runner.js', import.meta.url), 'utf8'));
});
