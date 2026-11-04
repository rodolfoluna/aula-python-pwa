import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const target = new URL('../build/runner/', import.meta.url);
await mkdir(target, { recursive: true });
for (const file of ['runner.html', 'runner.js', 'runner.css', 'runner-theme-v1.css', 'python-worker.js', 'runner-sw.js', 'runtime-assets.json']) await copyFile(new URL('../dist/' + file, import.meta.url), new URL(file === 'runner.html' ? 'index.html' : file, target));
// El aula usa la ruta explícita para incrustar la consola.
await copyFile(new URL('../dist/runner.html', import.meta.url), new URL('runner.html', target));
const hash = createHash('sha256');
for (const file of ['runner.html', 'runner.js', 'runner.css', 'runner-theme-v1.css', 'python-worker.js', 'runtime-assets.json']) hash.update(await readFile(new URL(file, target)));
await writeFile(new URL('runner-sw.js', target), (await readFile(new URL('../dist/runner-sw.js', import.meta.url), 'utf8')).replaceAll('__RUNNER_VERSION__', hash.digest('hex').slice(0, 16)));
console.log('Consola estática preparada: ' + fileURLToPath(target));
