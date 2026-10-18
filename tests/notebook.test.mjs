import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseNotebook, exportNotebook, editCell, addCell, createCell, deleteCell, moveCell, clone } from '../dist/notebook.js';
import { restoreState, initialState } from '../dist/model.js';
const example = await readFile(new URL('../dist/examples/actividad.ipynb', import.meta.url), 'utf8');
test('importa fuentes en lista, tipos y bloqueos estándar de Jupyter', () => {
  const notebook = parseNotebook(example);
  assert.equal(notebook.cells.length, 3); assert.match(notebook.cells[0].code, /## Calcula un promedio\n\n/);
  assert.deepEqual(notebook.cells.map(c => c.locked), [true, true, false]);
  assert.deepEqual(notebook.permissions, { add: false, delete: false, reorder: false });
});
test('exportación e importación conservan texto, títulos, adjuntos y permisos', () => {
  const notebook = parseNotebook(example); notebook.permissions.add = true;
  notebook.cells[0].attachments = { 'img.png': { 'image/png': 'abc' } }; notebook.cells[0].metadata.tags = ['instrucciones'];
  const exported = exportNotebook(notebook), imported = parseNotebook(JSON.stringify(exported));
  assert.equal(exported.nbformat_minor, 5); assert.deepEqual(imported.cells, notebook.cells.map(c => ({ ...c, metadata: exported.cells.find(item => item.id === c.id).metadata })));
  assert.deepEqual(imported.permissions, notebook.permissions); assert.equal(imported.title, notebook.title);
  assert.equal(exported.cells[1].metadata.editable, false); assert.deepEqual(exported.cells[1].outputs, []);
});
test('rechaza JSON dañado, versiones, tipos, lenguajes, tamaño y contenido inválidos', () => {
  const base = JSON.parse(example);
  for (const doc of ['{', JSON.stringify({ ...base, nbformat: 3 }), JSON.stringify({ ...base, metadata: { language_info: { name: 'julia' } } }), JSON.stringify({ ...base, cells: [{ cell_type: 'alien', metadata: {}, source: '' }] }), JSON.stringify({ ...base, cells: [{ cell_type: 'code', metadata: {}, source: [1] }] }), JSON.stringify({ ...base, cells: Array(101).fill(base.cells[0]) })]) assert.throws(() => parseNotebook(doc));
  assert.throws(() => parseNotebook(' '.repeat(2 * 1024 * 1024 + 1)), /2 MB/);
});
test('genera ids únicos y avisa de salidas, raw y comandos especiales sin ejecutar', () => {
  const doc = JSON.parse(example); doc.cells[1].source = '!pip install foo'; doc.cells[1].outputs = [{ output_type: 'stream', text: 'antiguo' }]; doc.cells.push({ ...doc.cells[0], cell_type: 'raw' });
  const imported = parseNotebook(JSON.stringify(doc)); assert.equal(new Set(imported.cells.map(c => c.id)).size, 4); assert.equal(imported.warnings.length, 3);
});
test('alumno no altera bloqueos ni plantilla, aun con permisos de estructura abiertos', () => {
  const { cells } = parseNotebook(example), student = clone(cells), permissions = { add: true, delete: true, reorder: true };
  assert.throws(() => editCell(student, 'ejemplo', { code: 'trampa' }, 'student'));
  assert.throws(() => editCell(student, 'solucion', { locked: false }, 'student'));
  assert.throws(() => deleteCell(student, 'ejemplo', 'student', permissions));
  assert.throws(() => moveCell(student, 2, -1, 'student', permissions));
  editCell(student, 'solucion', { code: 'print(9)' }, 'student'); assert.notEqual(student[2].code, cells[2].code);
  assert.throws(() => addCell(student, createCell(), 'student', { add: false }));
  addCell(student, createCell(), 'student', permissions); moveCell(student, 3, -1, 'student', permissions);
  deleteCell(student, student[2].id, 'student', permissions); assert.equal(student.length, 3);
});
test('profesor puede desbloquear, cambiar tipo, reordenar y eliminar', () => {
  const { cells } = parseNotebook(example);
  editCell(cells, 'ejemplo', { locked: false, type: 'markdown' }, 'teacher'); assert.equal(cells[1].type, 'markdown');
  moveCell(cells, 0, 1, 'teacher', {}); deleteCell(cells, 'ejemplo', 'teacher', {}); assert.equal(cells.length, 2);
});
test('migra el guardado anterior sin perder código ni archivos', () => {
  const original = initialState(); const legacy = clone(original);
  delete legacy.permissions; delete legacy.studentCells; delete legacy.notebookMetadata; delete legacy.notebookTitle;
  legacy.cells = legacy.cells.map(({ id, title, code }) => ({ id, title, code }));
  const restored = restoreState(JSON.stringify(legacy)); assert.deepEqual(restored, original);
});
