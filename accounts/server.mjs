import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createSupabaseStore } from './supabase-store.mjs';
import { AccountError, createAccountsService, studentEmail } from './service.mjs';
import { createActivitiesService } from './activities.mjs';
import { hostingConfig } from './hosting.mjs';
const publicRoot = new URL('../accounts-public/', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const SESSION_MS = 8 * 60 * 60 * 1000;
const extraModules = new Map([['/dist/answer-patch.js', ['../dist/answer-patch.js', 'text/javascript']], ['/sync-policy.js', ['sync-policy.js', 'text/javascript']]]);
for (const name of ['pwa.js', 'offline-store.js', 'sw.js', 'shell-assets.js', 'navigation.js', 'theme.js', 'code-editor.js', 'vendor/code-editor.js']) extraModules.set('/' + name, [name, 'text/javascript']);
extraModules.set('/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']);
extraModules.set('/vendor/code-editor.LICENSE.txt', ['vendor/code-editor.LICENSE.txt', 'text/plain']);
for (const size of [192, 512]) extraModules.set(`/icons/icon-${size}.png`, [`icons/icon-${size}.png`, 'image/png']);
const staticFiles = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']], ['/csv.js', ['csv.js', 'text/javascript']], ['/activities.js', ['activities.js', 'text/javascript']], ['/worksheet.js', ['worksheet.js', 'text/javascript']], ['/draft-sync.js', ['draft-sync.js', 'text/javascript']], ['/activities.css', ['activities.css', 'text/css']], ...['activity-model.js', 'notebook.js', 'markdown.js', 'vendor/marked.js'].map(name => ['/dist/' + name, ['../dist/' + name, 'text/javascript']])]);

export function createAccountsServer({ store, configError, secure = false, origin, runnerOrigin = 'http://127.0.0.1:4173' } = {}) {
  const sessions = new Map(), attempts = new Map();
  const service = store && createAccountsService(store);
  const activities = store && createActivitiesService(store);
  function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
  function revoke(id) { for (const [key, session] of sessions) if (session.userId === id) sessions.delete(key); }
  function sessionCookie(res, token = '') { res.setHeader('Set-Cookie', `aula_session=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${token ? 28800 : 0}${secure ? '; Secure' : ''}`); }
  function issue(res, userId, email) {
    const token = randomBytes(32).toString('base64url');
    sessions.set(hash(token), { userId, email, expires: Date.now() + SESSION_MS }); sessionCookie(res, token);
  }
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new AccountError(413, 'La solicitud supera 1 MB.'); chunks.push(chunk); }
    try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
    catch { throw new AccountError(400, 'Solicitud JSON inválida.'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Permissions-Policy', `cross-origin-isolated=(self "${runnerOrigin}")`);
    const styleNonce = randomBytes(18).toString('base64');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${styleNonce}'; connect-src 'self'; frame-src ${runnerOrigin}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    try {
      const path = new URL(req.url, 'http://local').pathname;
      if (path === '/healthz' && req.method === 'GET') { json(res, store ? 200 : 503, { ok: !!store }); return; }
      if (!path.startsWith('/api/')) {
        const file = staticFiles.get(path) || extraModules.get(path);
        if (!file || req.method !== 'GET') { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', file[1] + '; charset=utf-8');
        const bytes = await readFile(new URL(file[0], publicRoot));
        res.end(path === '/' ? bytes.toString('utf8').replace('<!--STYLE_NONCE-->', `<meta name="style-nonce" content="${styleNonce}">`) : bytes); return;
      }
      const expectedOrigin = origin || `http://127.0.0.1:${server.address().port}`;
      if ((req.headers.origin && req.headers.origin !== expectedOrigin) || (req.method !== 'GET' && req.headers.origin !== expectedOrigin)) throw new AccountError(403, 'Origen de la solicitud no permitido.');
      for (const [key, session] of sessions) if (session.expires <= Date.now()) sessions.delete(key);
      for (const [key, attempt] of attempts) if (attempt.expires <= Date.now()) attempts.delete(key);
      if (path === '/api/status' && req.method === 'GET') { json(res, 200, { configured: !!store, runnerOrigin, message: store ? 'Supabase configurado' : configError || 'Falta configurar .env' }); return; }
      if (!store) throw new AccountError(503, 'Configura Supabase en .env y reinicia este servidor.');
      if (path === '/api/login' && req.method === 'POST') {
        const data = await body(req);
        if (typeof data.login !== 'string' || data.login.length > 254 || typeof data.password !== 'string' || data.password.length > 128 || !data.password) throw new AccountError(400, 'Introduce tu usuario y contraseña.');
        const login = data.login.trim();
        let email;
        try { email = login.includes('@') ? login.toLowerCase() : studentEmail(login); }
        catch { throw new AccountError(400, 'El número de control no tiene un formato válido.'); }
        const key = hash((req.socket.remoteAddress || '') + email), ipKey = 'ip:' + (req.socket.remoteAddress || '');
        if (attempts.size > 10000) throw new AccountError(429, 'Demasiados intentos. Espera unos minutos.');
        for (const [rateKey, limit] of [[key, 10], [ipKey, 200]]) {
          const previous = attempts.get(rateKey) || { count: 0, expires: Date.now() + 15 * 60 * 1000 };
          if (previous.count >= limit) throw new AccountError(429, 'Demasiados intentos. Espera 15 minutos.');
          previous.count++; attempts.set(rateKey, previous);
        }
        let id;
        try { id = await store.login(email, data.password); } catch { throw new AccountError(401, 'Usuario o contraseña incorrectos.'); }
        const profile = await store.profile(id);
        if (!profile?.active) throw new AccountError(401, 'Usuario o contraseña incorrectos.');
        attempts.delete(key); issue(res, id, email); json(res, 200, { profile }); return;
      }
      const cookie = /(?:^|;\s*)aula_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
      const session = cookie && sessions.get(hash(cookie[1]));
      const profile = session && await store.profile(session.userId);
      if (!profile?.active) { sessionCookie(res); throw new AccountError(401, 'Inicia sesión para continuar.'); }
      if (path === '/api/logout' && req.method === 'POST') { sessions.delete(hash(cookie[1])); sessionCookie(res); json(res, 200, { ok: true }); return; }
      if (path === '/api/me' && req.method === 'GET') { json(res, 200, { profile }); return; }
      if (path === '/api/password' && req.method === 'POST') {
        const data = await body(req); await service.changePassword(profile, session.email, data.currentPassword, data.password);
        revoke(profile.id); issue(res, profile.id, session.email); json(res, 200, { ok: true }); return;
      }
      if (profile.must_change_password) throw new AccountError(403, 'Debes cambiar tu contraseña antes de continuar.');
      if (path === '/api/activities' && req.method === 'GET') { json(res, 200, await activities.list(profile)); return; }
      if (path === '/api/activity-open' && req.method === 'POST') { const data = await body(req); json(res, 200, await activities.open(profile, data.assignmentId, data.studentId)); return; }
      if (path === '/api/review-history' && req.method === 'POST') { json(res, 200, await activities.reviewHistory(profile, await body(req))); return; }
      if (path === '/api/answer-save' && req.method === 'POST') { const data = await body(req); if (data.actorId && data.actorId !== profile.id) throw new AccountError(403, 'La sesión no corresponde al alumno dueño del avance.'); const { answer, ...receipt } = await activities.saveAnswer(profile, data); json(res, 200, { submission: receipt }); return; }
      if (path === '/api/my-groups' && req.method === 'GET') { json(res, 200, { groups: await store.studentGroups(profile.id) }); return; }
      if (profile.role !== 'teacher') throw new AccountError(403, 'Esta operación requiere una cuenta de profesor.');
      if (path === '/api/activity-template' && req.method === 'POST') { const data = await body(req); json(res, 200, { activity: await activities.template(profile, data.activityId) }); return; }
      if (path === '/api/activity-save' && req.method === 'POST') { json(res, 200, { activity: await activities.saveActivity(profile, await body(req)) }); return; }
      if (path === '/api/assign-activity' && req.method === 'POST') { json(res, 201, { assignments: await activities.assign(profile, await body(req)) }); return; }
      if (path === '/api/activity-progress' && req.method === 'POST') { const data = await body(req); json(res, 200, await activities.progress(profile, data.assignmentId, data.token)); return; }
      if (path === '/api/answer-review' && req.method === 'POST') { json(res, 200, { review: await activities.review(profile, await body(req)) }); return; }
      if (path === '/api/assignment-delete' && req.method === 'POST') { json(res, 200, await activities.deleteAssignment(profile, await body(req))); return; }
      if (path === '/api/assignment-deadline' && req.method === 'POST') { json(res, 200, { assignment: await activities.setDeadline(profile, await body(req)) }); return; }
      if (path === '/api/student-deadline' && req.method === 'POST') { json(res, 200, { deadline: await activities.setStudentDeadline(profile, await body(req)) }); return; }
      if (path === '/api/assignment-state' && req.method === 'POST') { json(res, 200, { assignment: await activities.close(profile, await body(req)) }); return; }
      if (path === '/api/roster' && req.method === 'GET') {
        const [students, groups] = await Promise.all([store.listStudents(profile.id), store.listGroups(profile.id)]);
        const memberships = await store.listMemberships(profile.id, groups);
        json(res, 200, { students, groups, memberships }); return;
      }
      if (path === '/api/students' && req.method === 'POST') { const data = await body(req); json(res, 200, await service.importStudents(profile, data.rows, data.groupId)); return; }
      if (path === '/api/groups' && req.method === 'POST') { const data = await body(req); json(res, 201, { group: await service.createGroup(profile, data.name) }); return; }
      if (path === '/api/membership' && req.method === 'POST') { const data = await body(req); await service.membership(profile, data.groupId, data.studentId, data.member); json(res, 200, { ok: true }); return; }
      if (path === '/api/reset-password' && req.method === 'POST') { const data = await body(req); const credential = await service.resetPassword(profile, data.studentId); revoke(data.studentId); json(res, 200, { credential }); return; }
      if (path === '/api/student-active' && req.method === 'POST') { const data = await body(req); await service.setActive(profile, data.studentId, data.active); revoke(data.studentId); json(res, 200, { ok: true }); return; }
      throw new AccountError(404, 'Operación no encontrada.');
    } catch (error) {
      const missingSchema = ['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST202'].includes(error.code);
      json(res, missingSchema ? 503 : error.status || 500, { error: missingSchema ? 'Falta actualizar la base de datos. Sigue ACTIVIDADES_SETUP.md y ejecuta la migración de actividades en Supabase.' : error.status ? error.message : 'No se pudo completar la operación. Revisa las tablas y la configuración de Supabase.' });
    }
  });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let store, configError;
  try { store = createSupabaseStore(); } catch (error) { configError = error.message; }
  try {
    const { port, host, ...options } = hostingConfig();
    if (process.env.NODE_ENV === 'production' && !store) throw new Error('Faltan las variables privadas de Supabase en el alojamiento.');
    createAccountsServer({ store, configError, ...options }).listen(port, host, () => console.log(`Aula Python: ${options.origin || `http://127.0.0.1:${port}`}${store ? '' : ' (pendiente de configurar .env)'}`));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
