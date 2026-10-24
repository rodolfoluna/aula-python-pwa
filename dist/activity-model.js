import { clone, permissionsFrom, createCell, canMove } from './notebook.js';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const idOK = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
export const filenameOK = name => /^[A-Za-z_][A-Za-z0-9_]*\.py$/.test(name);
export function text(value, max, label, empty = true) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error(`${label} no es válido.`);
  return value;
}
function uniqueIds(items) { if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Hay identificadores de celdas o ejercicios duplicados.'); }
function files(value, entry, limit = 20) {
  if (!record(value) || Object.keys(value).length < 1 || Object.keys(value).length > limit) throw new Error(`El espacio de trabajo necesita entre 1 y ${limit} archivos.`);
  const result = {};
  for (const [name, code] of Object.entries(value)) { if (!filenameOK(name)) throw new Error('Nombre de archivo Python inválido.'); result[name] = text(code, 100000, 'El código'); }
  if (!Object.hasOwn(result, entry)) throw new Error('El archivo principal no existe.');
  return result;
}
function cell(value) {
  if (!record(value) || !idOK(value.id) || !['code', 'markdown', 'raw'].includes(value.type) || typeof value.locked !== 'boolean') throw new Error('Celda inválida.');
  return { id: value.id, type: value.type, title: text(value.title, 160, 'El título de celda'), code: text(value.code, 100000, 'El contenido de celda'), locked: value.locked, metadata: { ...(value.metadata?.deletable === false ? { deletable: false } : {}) } };
}
function sizeCheck(value) { if (new TextEncoder().encode(JSON.stringify(value)).length > 512000) throw new Error('El contenido supera 500 KB. Reduce el código o las instrucciones.'); return value; }
export function normalizeActivity(input) {
  if (!record(input) || !['notebook', 'files'].includes(input.kind) || !record(input.content)) throw new Error('Tipo de actividad inválido.');
  const result = { title: text(input.title, 160, 'El título', false).trim(), instructions: text(input.instructions || '', 20000, 'Las instrucciones'), kind: input.kind };
  if (input.kind === 'notebook') {
    if (!Array.isArray(input.content.cells) || !input.content.cells.length || input.content.cells.length > 100) throw new Error('El notebook necesita entre 1 y 100 celdas.');
    const cells = input.content.cells.map(cell); uniqueIds(cells);
    result.content = { cells, permissions: permissionsFrom(input.content.permissions) };
  } else {
    if (!Array.isArray(input.content.exercises) || !input.content.exercises.length || input.content.exercises.length > 30) throw new Error('La actividad necesita entre 1 y 30 ejercicios.');
    const exercises = input.content.exercises.map(item => {
      if (!idOK(item.id)) throw new Error('Identificador de ejercicio inválido.');
      const fileMap = input.content.project ? null : files(item.files, item.entry);
      if (!input.content.project && (!Array.isArray(item.lockedFiles) || item.lockedFiles.some(name => !Object.hasOwn(fileMap, name)))) throw new Error('Archivos bloqueados inválidos.');
      return { id: item.id, title: text(item.title, 160, 'El título de ejercicio', false), prompt: text(item.prompt, 20000, 'El enunciado'), ...(input.content.project ? {} : { files: fileMap, entry: item.entry, lockedFiles: [...new Set(item.lockedFiles)] }) };
    }); uniqueIds(exercises); result.content = { exercises, ...(input.content.project ? { project: normalizeProject(input.content.project) } : {}) };
  }
  return sizeCheck(result);
}
export function initialAnswer(activity) {
  if (activity.kind === 'files' && activity.content.project) { const { files, entry } = activity.content.project; return { project: { files: clone(files), entry } }; }
  return activity.kind === 'notebook' ? { cells: clone(activity.content.cells) } : { exercises: activity.content.exercises.map(({ id, files, entry }) => ({ id, files: clone(files), entry })) };
}
export function validateAnswer(activity, input) {
  if (!record(input)) throw new Error('Respuesta inválida.');
  if (activity.kind === 'notebook') {
    if (!Array.isArray(input.cells) || input.cells.length > 100) throw new Error('Respuesta de notebook inválida.');
    const cells = input.cells.map(cell); uniqueIds(cells);
    const original = activity.content.cells, permissions = permissionsFrom(activity.content.permissions), originals = new Map(original.map(item => [item.id, item]));
    const retained = new Set(cells.map(item => item.id));
    for (const item of original) if (!retained.has(item.id) && (item.locked || item.metadata?.deletable === false || !permissions.delete)) throw new Error('No se puede eliminar una celda protegida.');
    for (const item of cells) {
      const base = originals.get(item.id);
      if (!base) { if (!permissions.add || item.locked || item.metadata.deletable === false) throw new Error('No se permite agregar esta celda.'); continue; }
      if (item.title !== base.title || item.type !== base.type || item.locked !== base.locked || (item.metadata.deletable === false) !== (base.metadata?.deletable === false)) throw new Error('Los permisos y tipos de las celdas no pueden modificarse.');
      if (base.locked && item.code !== base.code) throw new Error('No se puede modificar una celda bloqueada.');
    }
    const oldOrder = original.filter(item => retained.has(item.id)).map(item => item.id), newOrder = cells.filter(item => originals.has(item.id)).map(item => item.id);
    if (!permissions.reorder && JSON.stringify(oldOrder) !== JSON.stringify(newOrder)) throw new Error('No se permite reordenar celdas.');
    const lockedOrder = original.filter(item => item.locked).map(item => item.id);
    if (JSON.stringify(lockedOrder) !== JSON.stringify(cells.filter(item => item.locked).map(item => item.id))) throw new Error('No se pueden mover celdas bloqueadas.');
    function segments(items) { let segment = 0; return new Map(items.map(item => { const result = [item.id, segment]; if (item.locked) segment++; return result; })); }
    const before = segments(original), after = segments(cells);
    if (newOrder.some(id => before.get(id) !== after.get(id))) throw new Error('No se puede mover una celda a través de una bloqueada.');
    return sizeCheck({ cells });
  }
  if (input.project) {
    const base = projectWorkspace(activity), project = { files: files(input.project.files, input.project.entry, 600), entry: input.project.entry };
    for (const name of base.lockedFiles) if (project.files[name] !== base.files[name]) throw new Error('No se puede modificar ni eliminar un archivo bloqueado.');
    return sizeCheck({ project });
  }
  if (activity.content.project) throw new Error('Falta el proyecto de la actividad.');
  if (!Array.isArray(input.exercises) || input.exercises.length !== activity.content.exercises.length) throw new Error('Faltan ejercicios en la respuesta.');
  const exercises = activity.content.exercises.map((base, index) => {
    const item = input.exercises[index]; if (!item || item.id !== base.id) throw new Error('No se permite cambiar los ejercicios.');
    const fileMap = files(item.files, item.entry);
    for (const name of base.lockedFiles) if (fileMap[name] !== base.files[name]) throw new Error('No se puede modificar ni eliminar un archivo bloqueado.');
    return { id: base.id, files: fileMap, entry: item.entry };
  });
  return sizeCheck({ exercises });
}
export function newActivity(kind = 'notebook') {
  return { title: 'Nueva actividad', instructions: '', kind, content: kind === 'notebook' ? { cells: [createCell('markdown'), createCell('code')], permissions: permissionsFrom({}) } : { exercises: [newExercise()] } };
}
export function newExercise() { return { id: crypto.randomUUID(), title: 'Nuevo ejercicio', prompt: 'Describe aquí el ejercicio.', files: { 'main.py': '# Escribe tu solución\n' }, entry: 'main.py', lockedFiles: [] }; }
export { clone, createCell, canMove };

function normalizeProject(project) {
  const fileMap = files(project.files, project.entry, 600);
  if (!Array.isArray(project.lockedFiles) || project.lockedFiles.some(name => !Object.hasOwn(fileMap, name))) throw new Error('Archivos bloqueados inválidos.');
  return { files: fileMap, entry: project.entry, lockedFiles: [...new Set(project.lockedFiles)] };
}
// Convert legacy exercise workspaces without overwriting files with repeated names.
export function projectWorkspace(activity, answer) {
  if (activity.content.project) return { ...clone(activity.content.project), ...(answer?.project ? clone(answer.project) : {}) };
  const project = { files: {}, entry: '', lockedFiles: [] }, mappings = [];
  const reserve = (name, index) => {
    let target = name, suffix = 0;
    while (Object.hasOwn(project.files, target)) target = `ejercicio_${index + 1}_${++suffix}_${name}`;
    return target;
  };
  activity.content.exercises.forEach((base, index) => {
    const map = {}; mappings.push(map);
    for (const [name, code] of Object.entries(base.files)) {
      const target = reserve(name, index); map[name] = target; project.files[target] = code;
      if (base.lockedFiles.includes(name)) project.lockedFiles.push(target);
    }
    if (!project.entry) project.entry = map[base.entry];
  });
  if (answer?.project) return { ...project, ...clone(answer.project) };
  answer?.exercises?.forEach((work, index) => {
    const map = mappings[index];
    for (const name of Object.keys(map)) if (!Object.hasOwn(work.files, name)) delete project.files[map[name]];
    for (const [name, code] of Object.entries(work.files)) { const target = map[name] || reserve(name, index); project.files[target] = code; map[name] = target; }
    if (index === 0) project.entry = map[work.entry];
  });
  if (!Object.hasOwn(project.files, project.entry)) project.entry = Object.keys(project.files)[0];
  return project;
}
