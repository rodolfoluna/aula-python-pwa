import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { renderMarkdown } from '../dist/markdown.js';
function render(source) { const dom = new JSDOM('<div id="preview"></div>'); globalThis.document = dom.window.document; const element = document.querySelector('#preview'); renderMarkdown(element, source); return element; }
test('cursivas con asteriscos, guiones bajos y negritas anidadas', () => {
  const view = render('*cursiva* y _otra cursiva_ y **negrita con _énfasis_**');
  assert.equal(view.querySelectorAll('em').length, 3);
  assert.equal(view.querySelector('strong em').textContent, 'énfasis');
});
test('bloques multilinea con backticks, tildes e indentación conservan saltos y espacios', () => {
  for (const source of ['```python\nfor i in range(2):\n    print(i)\n```', '~~~python\nfor i in range(2):\n    print(i)\n~~~', '    for i in range(2):\n        print(i)']) {
    const view = render(source), code = view.querySelector('pre > code');
    assert.ok(code, source); assert.equal(code.textContent.trimEnd(), 'for i in range(2):\n    print(i)');
  }
});
test('cercas más largas pueden contener triple backtick sin cerrarse antes de tiempo', () => {
  const view = render('````text\n```python\nprint(1)\n```\n````');
  assert.equal(view.querySelectorAll('pre').length, 1); assert.match(view.querySelector('code').textContent, /```python\nprint\(1\)\n```/);
});
test('Markdown importado no crea scripts, imágenes remotas ni enlaces activos', () => {
  const view = render('<script>alert(1)</script>\n\n![x](https://example.com/x.png)\n\n[link](javascript:alert(1))\n\n`<b>seguro</b>`');
  assert.equal(view.querySelector('script, img, a, b'), null); assert.match(view.textContent, /seguro/);
});
test('las cursivas pueden sintetizarse aunque la fuente cargada solo tenga estilo normal', async () => {
  const css = await readFile(new URL('../dist/notebook.css', import.meta.url), 'utf8');
  assert.match(css, /\.markdown-preview em\s*\{[^}]*font-synthesis\s*:\s*style/);
});
