import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
const result = await build({ entryPoints: ['scripts/editor-entry.mjs'], bundle: true, format: 'esm', minify: true, metafile: true, outfile: 'accounts-public/vendor/code-editor.js', legalComments: 'none', banner: { js: '/*! CodeMirror and dependencies: MIT. See code-editor.LICENSE.txt. */' } });
const packages = new Set(Object.keys(result.metafile.inputs).map(path => path.match(/^node_modules\/(@[^/]+\/[^/]+|[^/]+)/)?.[1]).filter(Boolean));
const notices = [];
for (const name of [...packages].sort()) {
  const license = await readFile(`node_modules/${name}/LICENSE`, 'utf8');
  notices.push(`${name}\n${license}`);
}
await writeFile('accounts-public/vendor/code-editor.LICENSE.txt', notices.join('\n\n--------------------\n\n'));
console.log('Editor Python incluido para uso sin conexión.');
