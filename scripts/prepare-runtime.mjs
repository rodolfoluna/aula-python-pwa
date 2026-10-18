import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
const directory = new URL('../node_modules/pyodide/', import.meta.url), lock = JSON.parse(await readFile(new URL('pyodide-lock.json', directory), 'utf8'));
const packages = new Set();
function visit(name) { if (packages.has(name)) return; packages.add(name); for (const item of lock.packages[name].depends) visit(item); }
visit('matplotlib');
const assets = [];
for (const name of ['pyodide.mjs','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json']) assets.push({ url: base + name, sha256: createHash('sha256').update(await readFile(new URL(name,directory))).digest('hex') });
for (const name of packages) assets.push({ url: base + lock.packages[name].file_name, sha256: lock.packages[name].sha256 });
await writeFile(new URL('../dist/runtime-assets.json', import.meta.url), JSON.stringify({ version: '0.27.7', assets }, null, 2) + '\n');
console.log(`Manifiesto offline: ${assets.length} archivos de Python y Matplotlib.`);
