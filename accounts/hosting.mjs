function allowedOrigin(value, name, production) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Configura ${name} con la dirección completa del servicio.`); }
  if (url.username || url.password || url.search || url.hash || !['/', ''].includes(url.pathname) ||
    (production ? url.protocol !== 'https:' : !['http:', 'https:'].includes(url.protocol))) throw new Error(`${name} debe ser un origen ${production ? 'HTTPS' : 'HTTP o HTTPS'} sin rutas ni credenciales.`);
  if (production && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error(`${name} debe usar el dominio público del servicio.`);
  return url.origin;
}

export function hostingConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT || env.ACCOUNTS_PORT || 4180);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');
  const originValue = env.APP_ORIGIN || env.RENDER_EXTERNAL_URL;
  const runnerValue = env.RUNNER_ORIGIN || (env.RUNNER_HOSTNAME ? `https://${env.RUNNER_HOSTNAME}` : '');
  if (production && (!originValue || !runnerValue)) throw new Error('Configura APP_ORIGIN (o RENDER_EXTERNAL_URL) y RUNNER_ORIGIN (o RUNNER_HOSTNAME) antes de publicar.');
  const origin = originValue ? allowedOrigin(originValue, 'APP_ORIGIN', production) : undefined;
  const runnerOrigin = allowedOrigin(runnerValue || 'http://127.0.0.1:4173', 'RUNNER_ORIGIN', production);
  if (origin === runnerOrigin) throw new Error('La consola Python debe estar en un origen distinto del aula.');
  return { port, host: production ? '0.0.0.0' : '127.0.0.1', secure: production, origin, runnerOrigin };
}
