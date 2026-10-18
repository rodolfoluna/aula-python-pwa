import { MAX_CELLS, MAX_NOTEBOOK_BYTES, clone, cellType, createCell, canEdit, canDelete, canMove, editCell, addCell, deleteCell, moveCell, parseNotebook, exportNotebook } from './notebook.js';
import { renderMarkdown } from './markdown.js';
const $ = selector => document.querySelector(selector);

export function setupNotebookEditor({ state, save, isBusy, invalidateRuntime, runTask, execute, setCurrentOutput, editorBehavior }) {
  let role = 'teacher', stagedImport;
  const results = { teacher: new Map(), student: new Map() };
  const cells = () => role === 'teacher' ? state.cells : state.studentCells;
  const notice = text => { $('#notebook-notice').textContent = text; $('#notebook-notice').hidden = !text; };
  function teacherChanged() { if (role === 'teacher') { state.studentCells = null; results.student.clear(); } save(); }
  function invalidate() { invalidateRuntime(); }
  function act(action) {
    if (isBusy()) return;
    try { action(); teacherChanged(); invalidate(); render(); }
    catch (error) { notice(error.message); }
  }
  function syncBusy() {
    const busy = isBusy(), student = role === 'student';
    $('#role-selector').disabled = busy;
    $('#notebook-title').readOnly = student;
    $('#notebook-title').disabled = busy;
    $('#teacher-tools').hidden = student; $('#student-permissions').hidden = student; $('#student-banner').hidden = !student;
    document.querySelectorAll('#teacher-tools button, #student-permissions input, #reset-student, #new-cell-type').forEach(el => { el.disabled = busy; });
    $('#add-cell').hidden = student && !state.permissions.add;
    $('#new-cell-type').hidden = student && !state.permissions.add;
    $('#add-cell').disabled = busy || cells().length >= MAX_CELLS;
    $('#run-all').disabled = busy || !cells().some(cell => cellType(cell) === 'code');
    document.querySelectorAll('#cells button, #cells select, #cells input, #cells textarea').forEach(el => { el.disabled = busy || el.dataset.unavailable === 'true'; });
    document.querySelectorAll('#cells textarea').forEach(el => { el.readOnly = el.dataset.readonly === 'true'; });
  }
  function makeButton(text, label, onclick, unavailable = false) {
    const button = document.createElement('button'); button.textContent = text; button.setAttribute('aria-label', label); button.title = label;
    button.dataset.unavailable = String(unavailable); button.onclick = onclick; return button;
  }
  function render() {
    const notebookCells = cells();
    const ids = new Set(notebookCells.map(cell => cell.id));
    for (const id of results[role].keys()) if (!ids.has(id)) results[role].delete(id);
    $('#notebook-title').value = state.notebookTitle;
    for (const checkbox of document.querySelectorAll('[data-permission]')) checkbox.checked = state.permissions[checkbox.dataset.permission];
    $('#cell-summary').textContent = `${notebookCells.length} celdas · ${notebookCells.filter(c => c.locked).length} bloqueadas`;
    $('#cells').replaceChildren();
    if (!notebookCells.length) { const empty = document.createElement('p'); empty.className = 'empty-notebook'; empty.textContent = 'Este notebook está vacío. Agrega una celda de código o de instrucciones.'; $('#cells').append(empty); }
    for (const [index, cell] of notebookCells.entries()) {
      let result = results[role].get(cell.id);
      if (!result) {
        const output = document.createElement('div'); output.className = 'output';
        result = { output, count: '[ ]', status: cellType(cell) === 'code' ? 'Sin ejecutar' : 'Texto' };
        results[role].set(cell.id, result);
      }
      const article = document.createElement('article'); article.className = 'cell' + (cell.locked ? ' locked-cell' : ''); article.dataset.cell = cell.id;
      const header = document.createElement('div'); header.className = 'cell-header';
      const count = document.createElement('span'); count.className = 'cell-count'; count.textContent = cellType(cell) === 'code' ? result.count : '¶';
      const title = document.createElement(role === 'teacher' ? 'input' : 'span'); title.className = 'cell-title';
      if (role === 'teacher') {
        title.value = cell.title; title.maxLength = 120; title.setAttribute('aria-label', `Título celda ${index + 1}`);
        title.oninput = () => { if (isBusy()) return; editCell(notebookCells, cell.id, { title: title.value }, role); teacherChanged(); };
      } else title.textContent = cell.title;
      const lockLabel = document.createElement('span'); lockLabel.className = 'lock-badge'; lockLabel.textContent = cell.locked ? 'Bloqueada' : 'Editable';
      const status = document.createElement('span'); status.className = 'cell-state'; status.textContent = result.status;
      header.append(count, title, lockLabel, status);
      if (role === 'teacher') {
        const type = document.createElement('select'); type.className = 'cell-type'; type.setAttribute('aria-label', `Tipo celda ${index + 1}`);
        for (const [value, text] of [['code', 'Código'], ['markdown', 'Markdown'], ['raw', 'Texto raw']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; type.append(option); }
        type.value = cellType(cell);
        type.onchange = () => act(() => editCell(notebookCells, cell.id, { type: type.value }, role));
        header.append(type);
        const lock = makeButton(cell.locked ? 'Desbloquear' : 'Bloquear', `${cell.locked ? 'Desbloquear' : 'Bloquear'} celda ${index + 1} para alumnos`, () => act(() => editCell(notebookCells, cell.id, { locked: !cell.locked }, role)));
        lock.className = 'lock-cell'; lock.setAttribute('aria-pressed', String(cell.locked)); header.append(lock);
      }
      if (role === 'teacher' || state.permissions.reorder) {
        header.append(makeButton('↑', `Subir celda ${index + 1}`, () => act(() => moveCell(notebookCells, index, -1, role, state.permissions)), !canMove(notebookCells, index, -1, role, state.permissions)));
        header.append(makeButton('↓', `Bajar celda ${index + 1}`, () => act(() => moveCell(notebookCells, index, 1, role, state.permissions)), !canMove(notebookCells, index, 1, role, state.permissions)));
      }
      if (role === 'teacher' || state.permissions.delete) header.append(makeButton('Eliminar', `Eliminar celda ${index + 1}`, () => {
        if (!canDelete(cell, role, state.permissions) || !confirm('¿Eliminar esta celda? Descarga antes el notebook si deseas conservar una copia.')) return;
        act(() => deleteCell(notebookCells, cell.id, role, state.permissions));
      }, !canDelete(cell, role, state.permissions)));
      const editor = document.createElement('textarea'); editor.className = 'code-editor'; editor.value = cell.code; editor.spellcheck = false; editor.setAttribute('aria-label', `Código celda ${index + 1}`); editor.rows = Math.min(20, Math.max(3, cell.code.split('\n').length + 1));
      editor.dataset.readonly = String(!canEdit(cell, role));
      const preview = document.createElement('div'); preview.className = 'markdown-preview';
      if (cellType(cell) === 'markdown') renderMarkdown(preview, cell.code);
      const studentInstructions = role === 'student' && cell.locked && cellType(cell) === 'markdown';
      editor.hidden = studentInstructions;
      editorBehavior(editor, value => {
        try { editCell(notebookCells, cell.id, { code: value }, role); result.status = cellType(cell) === 'code' ? 'Código modificado' : 'Texto modificado'; status.textContent = result.status; teacherChanged(); if (cellType(cell) === 'markdown') renderMarkdown(preview, value); }
        catch (error) { editor.value = cell.code; notice(error.message); }
      });
      const output = result.output; output.setAttribute('aria-label', `Salida celda ${index + 1}`);
      if (cellType(cell) === 'code') {
        async function runCell() {
          result.status = 'Ejecutando…'; status.textContent = result.status;
          const ok = await execute({ mode: 'notebook', code: cell.code, filename: `celda_${index + 1}.py` }, output);
          result.count = ok ? '[✓]' : '[!]'; result.status = ok ? 'Completada' : 'Detenida / error';
          count.textContent = result.count; status.textContent = result.status; return ok;
        }
        const run = makeButton('▶ Ejecutar', `Ejecutar celda ${index + 1}`, () => { setCurrentOutput(output); runTask(runCell); }); run.className = 'run-cell'; header.append(run); article.runCell = runCell;
      }
      article.append(header, editor);
      if (cellType(cell) === 'markdown') article.append(preview);
      article.append(output); $('#cells').append(article);
    }
    syncBusy();
  }
  $('#add-cell').onclick = () => act(() => addCell(cells(), createCell($('#new-cell-type').value), role, state.permissions));
  $('#run-all').onclick = () => {
    if (isBusy()) return;
    const executable = [...$('#cells').children].filter(article => article.runCell);
    if (!executable.length) return;
    setCurrentOutput(executable[0].querySelector('.output'));
    runTask(async () => { for (const article of executable) { if (!await article.runCell()) break; } });
  };
  $('#notebook-title').oninput = event => { if (role !== 'teacher' || isBusy()) return; state.notebookTitle = event.target.value; teacherChanged(); };
  for (const checkbox of document.querySelectorAll('[data-permission]')) checkbox.onchange = () => { if (role !== 'teacher' || isBusy()) return; state.permissions[checkbox.dataset.permission] = checkbox.checked; teacherChanged(); };
  $('#role-selector').onchange = event => {
    if (isBusy()) { event.target.value = role; return; }
    role = event.target.value === 'student' ? 'student' : 'teacher';
    if (role === 'student' && !state.studentCells) state.studentCells = clone(state.cells);
    invalidate(); notice(''); render(); save();
  };
  $('#reset-student').onclick = () => { if (role !== 'student' || isBusy() || !confirm('¿Restablecer tu copia con la plantilla del profesor? Se perderán las respuestas de prueba.')) return; state.studentCells = clone(state.cells); results.student.clear(); invalidate(); render(); save(); };
  $('#new-notebook').onclick = () => {
    if (role !== 'teacher' || isBusy() || !confirm('¿Crear un notebook vacío? Descarga el actual antes si deseas conservarlo.')) return;
    state.cells = []; state.notebookTitle = 'Nuevo notebook'; state.notebookMetadata = {}; state.permissions = { add: false, delete: false, reorder: false }; results.teacher.clear();
    teacherChanged(); invalidate(); notice('Notebook nuevo. Agrega la primera celda.'); render();
  };
  $('#import-notebook').onclick = () => { if (role === 'teacher' && !isBusy()) $('#notebook-file').click(); };
  $('#notebook-file').onchange = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || role !== 'teacher' || isBusy()) return;
    try {
      if (file.size > MAX_NOTEBOOK_BYTES) throw new Error('El notebook supera el límite de 2 MB.');
      const imported = parseNotebook(await file.text(), file.name);
      if (role !== 'teacher' || isBusy()) return;
      stagedImport = imported;
      $('#import-summary').textContent = `${imported.title}: ${imported.cells.length} celdas, ${imported.cells.filter(c => c.type === 'code').length} de código y ${imported.cells.filter(c => c.locked).length} bloqueadas.`;
      $('#import-warnings').replaceChildren();
      for (const warning of imported.warnings) { const li = document.createElement('li'); li.textContent = warning; $('#import-warnings').append(li); }
      $('#import-dialog').showModal();
    } catch (error) { stagedImport = undefined; notice(error.message); }
  };
  $('#cancel-import').onclick = () => { stagedImport = undefined; $('#import-dialog').close(); };
  $('#confirm-import').onclick = () => {
    if (!stagedImport || role !== 'teacher' || isBusy()) return;
    state.cells = stagedImport.cells; state.notebookTitle = stagedImport.title; state.notebookMetadata = stagedImport.metadata; state.permissions = stagedImport.permissions; results.teacher.clear();
    notice('Notebook importado. No se ejecutó código automáticamente.'); stagedImport = undefined; $('#import-dialog').close(); teacherChanged(); invalidate(); render();
  };
  $('#export-notebook').onclick = () => {
    if (role !== 'teacher' || isBusy()) return;
    const data = exportNotebook({ cells: state.cells, title: state.notebookTitle, metadata: state.notebookMetadata, permissions: state.permissions });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/x-ipynb+json' }));
    const link = document.createElement('a'); link.href = url; link.download = (state.notebookTitle.replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'notebook') + '.ipynb'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice('Notebook descargado con sus bloqueos y permisos. Las salidas se generarán al volver a ejecutarlo.');
  };
  render();
  return { syncBusy };
}
