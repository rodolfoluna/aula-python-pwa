import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const version = '3.14.10', expected = '90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159';
const source = `https://www.python.org/ftp/python/${version}/python-${version}-embed-amd64.zip`;
if (process.platform !== 'win32') throw new Error('La plantilla se construye en Windows; Render utiliza la plantilla versionada.');
await mkdir('.deployment/windows-export', { recursive: true }); await mkdir('accounts-public/exports', { recursive: true });
const zipPath = '.deployment/windows-export/python.zip';
let runtime; try { runtime = await readFile(zipPath); } catch { const response = await fetch(source); if (!response.ok) throw new Error('No se pudo descargar Python oficial'); runtime = Buffer.from(await response.arrayBuffer()); }
if (createHash('sha256').update(runtime).digest('hex') !== expected) throw new Error('La distribución de Python no coincide con la huella oficial.');
await writeFile(zipPath, runtime);
const path = `exports/python-${version}-win64.bin`;
execFileSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', ['/nologo', '/optimize+', '/target:exe', '/platform:x64', '/out:' + resolve('accounts-public', path), '/r:System.IO.Compression.dll', '/r:System.Web.Extensions.dll', '/resource:' + resolve(zipPath) + ',AulaPython.Runtime', resolve('scripts/windows-launcher.cs')], { stdio: 'inherit', windowsHide: true });
const template = await readFile('accounts-public/' + path), sha256 = createHash('sha256').update(template).digest('hex');
await writeFile('accounts-public/windows-runtime.js', `// Built from the official Python embeddable package; optional download, never includes student code.\nexport const windowsRuntime = ${JSON.stringify({ version, path: '/' + path, sha256, bytes: template.length, source }, null, 2)};\n`);
console.log(`Plantilla Windows preparada: ${template.length} bytes; Python ${version}; SHA-256 ${sha256}`);
