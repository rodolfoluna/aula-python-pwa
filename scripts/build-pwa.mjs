import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
export const shellAssets = ['/', '/styles.css', '/activities.css', '/app.js', '/activities.js', '/worksheet.js', '/draft-sync.js', '/sync-policy.js', '/csv.js', '/offline-store.js', '/pwa.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/dist/activity-model.js', '/dist/answer-patch.js', '/dist/notebook.js', '/dist/markdown.js', '/dist/vendor/marked.js'];
shellAssets.push('/navigation.js', '/theme.js', '/code-editor.js', '/vendor/code-editor.js');
shellAssets.push('/project-downloads.js', '/windows-runtime.js');
const root = new URL('../accounts-public/', import.meta.url);
function crc(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const tag = Buffer.from(type), length = Buffer.alloc(4), sum = Buffer.alloc(4); length.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([tag, data]))); return Buffer.concat([length, tag, data, sum]); }
function icon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size), header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = x / size, ny = y / size, bracket = nx >= .25 && nx <= .48 && Math.abs(ny - (.32 + (nx - .25) * .8)) < .035 || nx >= .25 && nx <= .48 && Math.abs(ny - (.68 - (nx - .25) * .8)) < .035;
    const white = bracket || nx > .53 && nx < .77 && ny > .65 && ny < .71, offset = y * (size * 4 + 1) + 1 + x * 4;
    raw.set(white ? [240, 250, 244, 255] : [40, 92, 73, 255], offset);
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export async function buildPwa() {
  await mkdir(new URL('icons/', root), { recursive: true });
  for (const size of [192, 512]) await writeFile(new URL(`icons/icon-${size}.png`, root), icon(size));
  const hash = createHash('sha256');
  for (const path of shellAssets) hash.update(path).update(await readFile(new URL(path === '/' ? 'index.html' : path.startsWith('/dist/') ? '..' + path : '.' + path, root)));
  const version = hash.digest('hex').slice(0, 16);
  await writeFile(new URL('shell-assets.js', root), `self.AULA_SHELL = ${JSON.stringify({ version, assets: shellAssets })};\n`);
  return version;
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/build-pwa.mjs')) console.log('PWA preparada: ' + await buildPwa());
