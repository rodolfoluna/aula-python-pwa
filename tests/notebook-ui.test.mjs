import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { setupNotebookEditor } from '../dist/notebook-editor.js';
import { bindCodeEditor } from '../dist/code-editor.js';
import { initialState, restoreState } from '../dist/model.js';
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const example = await readFile(new URL('../dist/examples/actividad.ipynb', import.meta.url), 'utf8');

function setup() {
  const dom = new JSDOM(html, { url: 'http://localhost' });
  globalThis.document = dom.window.document;
  globalThis.confirm = () => true;
  for (const dialog of document.querySelectorAll('dialog')) { dialog.showModal = () => dialog.setAttribute('open', ''); dialog.close = () => dialog.removeAttribute('open'); }
  const state = initialState(), executed = [], $ = selector => document.querySelector(selector);
  let busy = false, saved;
  const editor = setupNotebookEditor({
    state, save: () => { saved = JSON.stringify(state); }, isBusy: () => busy, invalidateRuntime() {},
    setCurrentOutput() {}, runTask: task => task(), execute: async payload => { executed.push(payload); return true; },
    editorBehavior: (element, onChange) => bindCodeEditor(element, onChange, () => { saved = JSON.stringify(state); }),
  });
  const change = (element, value) => { element.value = value; element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
  async function importFile(text = example) {
    const input = $('#notebook-file'); Object.defineProperty(input, 'files', { value: [{ size: Buffer.byteLength(text), name: 'ejemplo.ipynb', text: async () => text }], configurable: true });
    await input.onchange({ target: input });
  }
  return { dom, state, executed, $, change, importFile, setBusy(value) { busy = value; editor.syncBusy(); }, saved: () => saved };
}

test('editor: añade Markdown, renderiza sin HTML y guarda sus cambios', () => {
  const ui = setup(); ui.change(ui.$('#new-cell-type'), 'markdown'); ui.$('#add-cell').click();
  assert.equal(ui.state.cells.at(-1).type, 'markdown'); assert.equal(ui.state.cells.at(-1).locked, true);
  const editor = ui.$('#cells').lastElementChild.querySelector('textarea');
  editor.value = '# Enunciado\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n**Texto**'; editor.dispatchEvent(new ui.dom.window.Event('input'));
  const preview = ui.$('#cells').lastElementChild.querySelector('.markdown-preview');
  assert.equal(preview.querySelector('h1').textContent, 'Enunciado'); assert.equal(preview.querySelector('script, img'), null); assert.equal(preview.querySelector('strong').textContent, 'Texto');
  assert.match(restoreState(ui.saved()).cells.at(-1).code, /<script>/);
});
test('vista alumno: bloqueos, Tab protegido y respuestas separadas de la plantilla', async () => {
  const ui = setup(); const lock = ui.$('[aria-label="Bloquear celda 1 para alumnos"]'); lock.click();
  const teacherCode = ui.state.cells[1].code;
  ui.change(ui.$('#role-selector'), 'student');
  assert.equal(ui.$('[aria-label="Código celda 1"]').readOnly, true); assert.equal(ui.$('#teacher-tools').hidden, true); assert.equal(ui.$('#add-cell').hidden, true);
  const locked = ui.$('[aria-label="Código celda 1"]'), original = locked.value;
  locked.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); assert.equal(locked.value, original);
  const editable = ui.$('[aria-label="Código celda 2"]'); editable.value = 'print("Mi respuesta")'; editable.dispatchEvent(new ui.dom.window.Event('input'));
  assert.equal(ui.state.cells[1].code, teacherCode); assert.equal(ui.state.studentCells[1].code, editable.value);
  await ui.$('[aria-label="Ejecutar celda 1"]').onclick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(ui.executed.length, 1); assert.equal(ui.executed[0].code, original);
  ui.change(ui.$('#role-selector'), 'teacher'); assert.equal(ui.$('[aria-label="Código celda 2"]').value, teacherCode);
  ui.change(ui.$('#role-selector'), 'student'); assert.equal(ui.$('[aria-label="Código celda 2"]').value, 'print("Mi respuesta")');
});
test('importación requiere confirmación, cancelar preserva plantilla y no ejecuta código', async () => {
  const ui = setup(), original = JSON.stringify(ui.state.cells);
  await ui.importFile(); assert.equal(JSON.stringify(ui.state.cells), original); assert.equal(ui.$('#import-dialog').hasAttribute('open'), true);
  ui.$('#cancel-import').click(); assert.equal(JSON.stringify(ui.state.cells), original);
  await ui.importFile(); ui.$('#confirm-import').click(); assert.equal(ui.state.cells.length, 3); assert.match(ui.state.notebookTitle, /Actividad de ejemplo/); assert.equal(ui.executed.length, 0);
  await ui.importFile('{'); assert.equal(ui.state.cells.length, 3); assert.match(ui.$('#notebook-notice').textContent, /JSON válido/);
});
test('Ejecutar todas salta Markdown y mantiene orden del código', async () => {
  const ui = setup(); await ui.importFile(); ui.$('#confirm-import').click();
  ui.$('#run-all').click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.executed.length, 2); assert.match(ui.executed[0].code, /calificaciones =/); assert.match(ui.executed[1].code, /Calcula e imprime/);
});
test('profesor reordena y cambia tipos; los controles respetan ejecución ocupada', () => {
  const ui = setup(), firstId = ui.state.cells[0].id;
  ui.$('[aria-label="Bajar celda 1"]').click(); assert.equal(ui.state.cells[1].id, firstId);
  ui.change(ui.$('[aria-label="Tipo celda 1"]'), 'markdown'); assert.equal(ui.$('[aria-label="Ejecutar celda 1"]'), null);
  ui.setBusy(true); assert.equal(ui.$('#role-selector').disabled, true); assert.equal(ui.$('#import-notebook').disabled, true); assert.equal(ui.$('[aria-label="Código celda 1"]').disabled, true);
  ui.setBusy(false); assert.equal(ui.$('#role-selector').disabled, false);
});
test('permisos del alumno persisten y habilitan creación sin permitir desbloquear', () => {
  const ui = setup(); const checkbox = ui.$('[data-permission="add"]'); checkbox.checked = true; checkbox.dispatchEvent(new ui.dom.window.Event('change'));
  ui.change(ui.$('#role-selector'), 'student'); assert.equal(ui.$('#add-cell').hidden, false); ui.$('#add-cell').click();
  assert.equal(ui.state.studentCells.length, 5); assert.equal(ui.state.cells.length, 4); assert.equal(ui.$('.lock-cell'), null);
  assert.equal(restoreState(ui.saved()).permissions.add, true);
});
