import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
export function createServer() {
  return http.createServer(async (req, res) => {
    // Required for synchronous input and Python interrupts in the worker.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const target = resolve(root, '.' + (path === '/' ? '/index.html' : path));
      if (!target.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      let content = await readFile(target);
      if (path === '/runner-sw.js') {
        const hash = createHash('sha256');
        for (const file of ['runner.html', 'runner.js', 'runner.css', 'runner-theme-v1.css', 'python-worker.js', 'runtime-assets.json']) hash.update(await readFile(resolve(root, file)));
        content = Buffer.from(content.toString().replaceAll('__RUNNER_VERSION__', hash.digest('hex').slice(0, 16)));
      }
      res.setHeader('Content-Type', (types[extname(target)] || 'application/octet-stream') + '; charset=utf-8');
      res.end(content);
    } catch { res.writeHead(404).end('No encontrado'); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  createServer().listen(port, '127.0.0.1', () => console.log(`Aula Python: http://127.0.0.1:${port}`));
}
