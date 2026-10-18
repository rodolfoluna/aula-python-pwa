import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const target = new URL('../build/runner/', import.meta.url);
await mkdir(target, { recursive: true });
for (const file of ['runner.html', 'runner.js', 'runner.css', 'python-worker.js']) await copyFile(new URL('../dist/' + file, import.meta.url), new URL(file === 'runner.html' ? 'index.html' : file, target));
// El aula usa la ruta explícita para incrustar la consola.
await copyFile(new URL('../dist/runner.html', import.meta.url), new URL('runner.html', target));
console.log('Consola estática preparada: ' + fileURLToPath(target));
