export const MAX_CELLS = 100;
export const MAX_NOTEBOOK_BYTES = 2 * 1024 * 1024;
export const DEFAULT_PERMISSIONS = Object.freeze({ add: false, delete: false, reorder: false });
export const cellType = cell => cell.type || 'code';
export const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
export function permissionsFrom(value) {
  return Object.fromEntries(Object.keys(DEFAULT_PERMISSIONS).map(key => [key, value?.[key] === true]));
}
export function normalizeCell(cell) {
  return { ...cell, type: cellType(cell), locked: cell.locked === true, metadata: object(cell.metadata) ? cell.metadata : {} };
}
export function createCell(type = 'code') {
  if (!['code', 'markdown', 'raw'].includes(type)) throw new Error('Tipo de celda no permitido.');
  return { id: crypto.randomUUID(), type, title: type === 'code' ? 'Nueva celda de código' : 'Nuevas indicaciones', code: type === 'code' ? '# Escribe tu código aquí\n' : '## Indicaciones\n\nEscribe aquí el enunciado.', locked: type !== 'code', metadata: {} };
}
export function canEdit(cell, role) { return role === 'teacher' || !cell.locked; }
export function canDelete(cell, role, permissions) { return role === 'teacher' || (!cell.locked && cell.metadata?.deletable !== false && permissions.delete); }
export function canMove(cells, index, delta, role, permissions) {
  const next = index + delta;
  return Math.abs(delta) === 1 && next >= 0 && next < cells.length && (role === 'teacher' || (permissions.reorder && !cells[index].locked && !cells[next].locked));
}
// Central policy checks are shared with the UI; these will also be required server-side.
export function editCell(cells, id, patch, role) {
  const cell = cells.find(item => item.id === id);
  if (!cell || !canEdit(cell, role)) throw new Error('Esta celda está bloqueada para el alumno.');
  if (role !== 'teacher' && Object.keys(patch).some(key => key !== 'code')) throw new Error('Solo el profesor puede cambiar el tipo, título o bloqueo.');
  if (Object.keys(patch).some(key => !['code', 'title', 'type', 'locked'].includes(key))) throw new Error('Cambio de celda no permitido.');
  if ('type' in patch && !['code', 'markdown', 'raw'].includes(patch.type)) throw new Error('Tipo de celda no permitido.');
  if ('code' in patch && typeof patch.code !== 'string') throw new Error('Contenido de celda no válido.');
  if ('title' in patch && typeof patch.title !== 'string') throw new Error('Título no válido.');
  if ('locked' in patch && typeof patch.locked !== 'boolean') throw new Error('Bloqueo no válido.');
  Object.assign(cell, patch);
}
export function addCell(cells, cell, role, permissions) {
  if (role !== 'teacher' && !permissions.add) throw new Error('El profesor no permite agregar celdas.');
  if (cells.length >= MAX_CELLS) throw new Error(`El límite es de ${MAX_CELLS} celdas.`);
  cells.push(role === 'teacher' ? cell : { ...cell, locked: false });
}
export function deleteCell(cells, id, role, permissions) {
  const index = cells.findIndex(cell => cell.id === id);
  if (index < 0 || !canDelete(cells[index], role, permissions)) throw new Error('No se permite eliminar esta celda.');
  cells.splice(index, 1);
}
export function moveCell(cells, index, delta, role, permissions) {
  if (!canMove(cells, index, delta, role, permissions)) throw new Error('No se permite mover esta celda.');
  [cells[index], cells[index + delta]] = [cells[index + delta], cells[index]];
}

export function parseNotebook(text, filename = 'Notebook.ipynb') {
  if (new TextEncoder().encode(text).length > MAX_NOTEBOOK_BYTES) throw new Error('El notebook supera el límite de 2 MB.');
  let doc;
  try { doc = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('El archivo no contiene JSON válido.'); }
  if (!object(doc) || doc.nbformat !== 4 || !Number.isInteger(doc.nbformat_minor) || doc.nbformat_minor < 0 || !Array.isArray(doc.cells) || !object(doc.metadata)) throw new Error('Se requiere un notebook Jupyter válido de formato 4.');
  if (doc.cells.length > MAX_CELLS) throw new Error(`El notebook supera el límite de ${MAX_CELLS} celdas.`);
  const language = doc.metadata.language_info?.name || doc.metadata.kernelspec?.language;
  const kernel = doc.metadata.kernelspec?.name;
  if ((language && !/^python\d*$/i.test(language)) || (!language && kernel && !/^python/i.test(kernel))) throw new Error('Solo se admiten notebooks de Python.');
  const warnings = new Set(), ids = new Set();
  const cells = doc.cells.map((cell, index) => {
    if (!object(cell) || !['code', 'markdown', 'raw'].includes(cell.cell_type) || !object(cell.metadata)) throw new Error(`La celda ${index + 1} tiene un tipo o metadatos no admitidos.`);
    if (!(typeof cell.source === 'string' || (Array.isArray(cell.source) && cell.source.every(line => typeof line === 'string')))) throw new Error(`El contenido de la celda ${index + 1} no es válido.`);
    const code = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
    let id = cell.id;
    if (!validId(id) || ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    if (cell.cell_type === 'code' && cell.outputs?.length) warnings.add('Las salidas anteriores se omiten. Ejecuta las celdas para generarlas de nuevo.');
    if (cell.cell_type === 'code' && /^\s*[%!]/m.test(code)) warnings.add('Hay comandos especiales de Jupyter (% o !). Debes adaptarlos antes de ejecutarlos.');
    if (cell.attachments && Object.keys(cell.attachments).length) warnings.add('Los adjuntos se conservan al exportar, pero no se muestran en esta vista previa.');
    if (cell.cell_type === 'raw') warnings.add('Las celdas raw se conservan como texto sin ejecutar.');
    if (cell.cell_type === 'markdown' && /<[^>]+>|!\[|\$/.test(code)) warnings.add('La vista Markdown no interpreta HTML, imágenes ni fórmulas LaTeX.');
    return {
      id, type: cell.cell_type,
      title: typeof cell.metadata.aula_python?.title === 'string' ? cell.metadata.aula_python.title : (cell.cell_type === 'code' ? `Código ${index + 1}` : `Indicaciones ${index + 1}`),
      code, locked: cell.metadata.editable === false || cell.metadata.aula_python?.locked === true,
      metadata: clone(cell.metadata),
      ...(object(cell.attachments) ? { attachments: clone(cell.attachments) } : {}),
    };
  });
  return {
    title: typeof doc.metadata.aula_python?.title === 'string' ? doc.metadata.aula_python.title : filename.replace(/\.ipynb$/i, ''),
    cells, metadata: clone(doc.metadata), permissions: permissionsFrom(doc.metadata.aula_python?.permissions), warnings: [...warnings],
  };
}
export function exportNotebook({ cells, title, metadata = {}, permissions = DEFAULT_PERMISSIONS }) {
  return {
    nbformat: 4, nbformat_minor: 5,
    metadata: { ...clone(metadata), kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { ...(metadata.language_info || {}), name: 'python' }, aula_python: { ...(metadata.aula_python || {}), title, permissions: permissionsFrom(permissions) } },
    cells: cells.map(cell => {
      const type = cellType(cell);
      return {
        id: cell.id, cell_type: type, source: cell.code,
        metadata: { ...clone(cell.metadata || {}), editable: !cell.locked, deletable: !cell.locked && cell.metadata?.deletable !== false, aula_python: { ...(cell.metadata?.aula_python || {}), title: cell.title, locked: cell.locked === true } },
        ...(type === 'code' ? { execution_count: null, outputs: [] } : (cell.attachments ? { attachments: clone(cell.attachments) } : {})),
      };
    }),
  };
}
