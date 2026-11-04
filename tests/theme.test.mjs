import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const source = await readFile(new URL('../accounts-public/theme.js', import.meta.url), 'utf8');

test('el tema sigue al sistema al inicio; el botón guarda preferencia y actualiza toda la app', () => {
  const dom = new JSDOM('<meta name="theme-color"><button id="theme-toggle"></button>', { url: 'https://aula.example/', runScripts: 'outside-only' });
  const { window } = dom; let systemChanged, changes = [];
  window.matchMedia = () => ({ matches: true, addEventListener: (event, handler) => { systemChanged = handler; } });
  window.addEventListener('aula-theme-change', event => changes.push(event.detail));
  try {
    window.eval(source); window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const root = window.document.documentElement, button = window.document.querySelector('button');
    assert.equal(root.dataset.theme, 'dark'); assert.equal(button.textContent, '☀ Tema claro');
    button.click(); assert.equal(root.dataset.theme, 'light'); assert.equal(window.localStorage.getItem('aula-theme'), 'light');
    assert.equal(button.getAttribute('aria-label'), 'Cambiar a tema oscuro');
    systemChanged({ matches: true }); assert.equal(root.dataset.theme, 'light');
    button.click(); assert.equal(root.dataset.theme, 'dark'); assert.equal(window.document.querySelector('meta').content, '#111827');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'aula-theme', newValue: 'light' }));
    assert.equal(root.dataset.theme, 'light'); assert.ok(changes.includes('dark') && changes.includes('light'));
  } finally { window.close(); }
});

test('el editor cambia de tema sin perder código, selección ni historial de deshacer', async () => {
  const dom = new JSDOM('<textarea aria-label="Código Python">print(42)</textarea>', { url: 'https://aula.example/', pretendToBeVisual: true });
  const { window } = dom;
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver, requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window) });
  const { mountCodeEditor } = await import('../accounts-public/code-editor.js');
  const cache = new Map(), field = document.querySelector('textarea'); let editor;
  try {
    editor = mountCodeEditor(field, { cache, cacheKey: 'main.py' });
    assert.equal(field.hidden, true); assert.equal(document.querySelector('.cm-content').textContent, 'print(42)');
    field.value = 'print(84)'; field.dispatchEvent(new window.Event('input'));
    document.documentElement.dataset.theme = 'dark'; window.dispatchEvent(new window.CustomEvent('aula-theme-change', { detail: 'dark' }));
    assert.equal(document.querySelector('.cm-content').textContent, 'print(84)');
    editor.destroy(); assert.ok(cache.get('main.py').state.history.done.length);
    editor = mountCodeEditor(field, { cache, cacheKey: 'main.py' });
    assert.equal(document.querySelector('.cm-content').textContent, 'print(84)');
    document.documentElement.dataset.theme = 'light'; window.dispatchEvent(new window.CustomEvent('aula-theme-change', { detail: 'light' }));
    assert.equal(field.value, 'print(84)');
  } finally { editor?.destroy(); dom.window.close(); }
});
