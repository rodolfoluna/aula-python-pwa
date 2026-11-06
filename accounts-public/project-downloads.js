import { filenameOK } from '../dist/activity-model.js';
import { windowsRuntime } from './windows-runtime.js';

const encoder = new TextEncoder();
function projectFiles(files, names = Object.keys(files)) {
  if (!names.length || names.length > 600 || new Set(names).size !== names.length) throw new Error('Selecciona entre 1 y 600 archivos.');
  for (const name of names) if (!filenameOK(name) || !Object.hasOwn(files, name) || typeof files[name] !== 'string') throw new Error('Archivo de proyecto no válido.');
  return names;
}
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function header(size) { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; }
export function projectZip(files, names = Object.keys(files)) {
  projectFiles(files, names); const parts = [], directory = []; let offset = 0, directorySize = 0;
  for (const name of names) {
    const filename = encoder.encode(name), code = encoder.encode(files[name]), crc = crc32(code), local = header(30), central = header(46);
    local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true); local.view.setUint16(6, 0x800, true); local.view.setUint16(12, 33, true); local.view.setUint32(14, crc, true); local.view.setUint32(18, code.length, true); local.view.setUint32(22, code.length, true); local.view.setUint16(26, filename.length, true);
    central.view.setUint32(0, 0x02014b50, true); central.view.setUint16(4, 20, true); central.view.setUint16(6, 20, true); central.view.setUint16(8, 0x800, true); central.view.setUint16(14, 33, true); central.view.setUint32(16, crc, true); central.view.setUint32(20, code.length, true); central.view.setUint32(24, code.length, true); central.view.setUint16(28, filename.length, true); central.view.setUint32(42, offset, true);
    parts.push(local.bytes, filename, code); directory.push(central.bytes, filename); offset += 30 + filename.length + code.length; directorySize += 46 + filename.length;
  }
  const end = header(22); end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, names.length, true); end.view.setUint16(10, names.length, true); end.view.setUint32(12, directorySize, true); end.view.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end.bytes], { type: 'application/zip' });
}
export function saveDownload(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  const timer = setTimeout(() => URL.revokeObjectURL(url), 60000); timer.unref?.();
}
export function downloadProjectFiles(files, names) {
  projectFiles(files, names);
  saveDownload(names.length === 1 ? new Blob([files[names[0]]], { type: 'text/x-python;charset=utf-8' }) : projectZip(files, names), names.length === 1 ? names[0] : 'archivos-python.zip');
}
export function supportsWindowsExe(navigator = globalThis.navigator) { return /Windows|Win32|Win64/i.test(navigator?.userAgentData?.platform || navigator?.platform || navigator?.userAgent || ''); }
async function validTemplate(bytes) {
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  return bytes.byteLength === windowsRuntime.bytes && digest === windowsRuntime.sha256;
}
export async function windowsTemplate({ fetchImpl = globalThis.fetch, cacheStorage = globalThis.caches, progress = () => {} } = {}) {
  const name = 'aula-windows-exe-' + windowsRuntime.sha256.slice(0, 16); let cache;
  try { cache = await cacheStorage?.open(name); const previous = await cache?.match(windowsRuntime.path); if (previous) { const bytes = await previous.arrayBuffer(); if (await validTemplate(bytes)) return bytes; await cache.delete(windowsRuntime.path); } } catch { }
  progress(`Descargando componente para Windows (${Math.ceil(windowsRuntime.bytes / 1048576)} MB)…`);
  let response;
  try { response = await fetchImpl(windowsRuntime.path, { credentials: 'omit', cache: 'no-cache' }); } catch { throw new Error('Conéctate una vez para descargar el componente de Windows. Tus archivos siguen guardados en este equipo.'); }
  if (!response.ok) throw new Error('No se pudo descargar el componente de Windows. Reintenta con conexión.');
  const bytes = await response.arrayBuffer();
  if (!await validTemplate(bytes)) throw new Error('El componente de Windows está incompleto o no coincide con su versión. Reintenta la descarga.');
  try { await cache?.put(windowsRuntime.path, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); for (const key of await cacheStorage?.keys() || []) if (key.startsWith('aula-windows-exe-') && key !== name) await cacheStorage.delete(key); } catch { progress('Componente descargado; no hubo espacio para conservarlo offline.'); }
  return bytes;
}
export async function windowsExecutable(files, entry, options) {
  projectFiles(files); if (!Object.hasOwn(files, entry)) throw new Error('No se encontró el archivo abierto.');
  for (const name of Object.keys(files)) if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\.py$/i.test(name)) throw new Error('Renombra «' + name + '»: ese nombre está reservado en Windows.');
  const payload = encoder.encode(JSON.stringify({ entry, files })); if (payload.length > 1048576) throw new Error('El proyecto supera el límite de 1 MB del ejecutable.');
  const template = await windowsTemplate(options), footer = new Uint8Array(12); footer.set(encoder.encode('AULAPY01')); new DataView(footer.buffer).setUint32(8, payload.length, true);
  return new Blob([template, payload, footer], { type: 'application/vnd.microsoft.portable-executable' });
}
