import { clone, createCell, canMove, newExercise, filenameOK, projectWorkspace } from '../dist/activity-model.js';
import { parseNotebook, exportNotebook } from '../dist/notebook.js';
import { renderMarkdown } from '../dist/markdown.js';

export function createWorksheet(root, options) {
  const { activity, answer, role, onChange = () => {}, run = () => {}, notice = () => {} } = options;
  const teacher = role === 'teacher'; let readonly = role === 'review' || options.readonly === true, exerciseIndex = 0, activeFile;
  const el = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
  function button(text, action, disabled = false, mutation = true) { const b = el('button', mutation ? 'worksheet-mutate' : 'worksheet-run', text); b.type = 'button'; b.disabled = disabled || (mutation && readonly); b.dataset.protectedDisabled = String(b.disabled); b.onclick = () => { if (!b.disabled) action(); }; return b; }
  function input(value, label, changed, multiline = false, locked = false) {
    const field = el(multiline ? 'textarea' : 'input', multiline ? 'worksheet-code' : 'worksheet-input'); field.value = value; field.setAttribute('aria-label', label); field.spellcheck = false; field.readOnly = readonly || locked;
    field.oninput = () => { if (field.readOnly) return; changed(field.value); onChange(); };
    if (multiline) { field.rows = Math.max(3, Math.min(18, value.split('\n').length + 1)); field.onkeydown = event => { if (event.key === 'Tab' && !field.readOnly) { event.preventDefault(); field.setRangeText('    ', field.selectionStart, field.selectionEnd, 'end'); changed(field.value); onChange(); } }; }
    return field;
  }
  function select(items, value, label, changed, disabled = false) { const field = el('select'); field.setAttribute('aria-label', label); for (const [key, text] of items) { const option = el('option', '', text); option.value = key; field.append(option); } field.value = value; field.disabled = disabled; field.dataset.protectedDisabled = String(disabled); field.onchange = () => { if (!field.disabled) changed(field.value); }; return field; }
  function changed() { onChange(); render(); }
  function notebook() {
    const cells = teacher ? activity.content.cells : answer.cells, permissions = activity.content.permissions;
    const toolbar = el('div', 'worksheet-toolbar');
    if (teacher) {
      const file = el('input'); file.type = 'file'; file.accept = '.ipynb'; file.hidden = true;
      file.onchange = async () => { const chosen = file.files?.[0]; file.value = ''; if (!chosen) return; try { if (chosen.size > 2 * 1024 * 1024) throw new Error('El archivo supera 2 MB.'); const parsed = parseNotebook(await chosen.text(), chosen.name); if (!confirm('¿Reemplazar las celdas del borrador con este notebook?')) return; activity.content.cells = parsed.cells; activity.content.permissions = parsed.permissions; changed(); notice(parsed.warnings.join(' ') || 'Notebook importado. Guarda la actividad para conservarlo.'); } catch (error) { notice(error.message, true); } };
      toolbar.append(button('Importar .ipynb', () => file.click()), file, button('Descargar .ipynb', () => {
        const data = exportNotebook({ cells, title: activity.title, permissions }); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/x-ipynb+json' })); const a = el('a'); a.href = url; a.download = 'actividad.ipynb'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }));
      for (const [key, label] of [['add', 'Alumno agrega celdas'], ['delete', 'Elimina editables'], ['reorder', 'Reordena editables']]) { const wrap = el('label', 'inline-label'), box = el('input'); box.type = 'checkbox'; box.checked = permissions[key]; box.onchange = () => { permissions[key] = box.checked; onChange(); }; wrap.append(box, el('span', '', label)); toolbar.append(wrap); }
    }
    if (teacher || permissions.add) {
      let type = 'code'; toolbar.append(select([['code', 'Código'], ['markdown', 'Markdown']], type, 'Tipo de nueva celda', value => { type = value; }));
      toolbar.append(button('Agregar celda', () => { const item = createCell(type); if (!teacher) item.locked = false; cells.push(item); changed(); }, cells.length >= 100));
    }
    toolbar.append(button('Ejecutar todas', () => run(cells.filter(cell => cell.type === 'code').map((cell, index) => ({ label: cell.title || `Celda ${index + 1}`, payload: { mode: 'notebook', code: cell.code, filename: `celda_${index + 1}.py` } }))), false, false)); root.append(toolbar);
    cells.forEach((cell, index) => {
      const article = el('article', 'worksheet-cell'), header = el('div', 'worksheet-toolbar');
      if (teacher) {
        header.append(input(cell.title, `Título celda ${index + 1}`, value => { cell.title = value; }), select([['code', 'Código'], ['markdown', 'Markdown'], ['raw', 'Texto raw']], cell.type, `Tipo celda ${index + 1}`, value => { cell.type = value; changed(); }, readonly));
        header.append(button(cell.locked ? 'Desbloquear' : 'Bloquear', () => { cell.locked = !cell.locked; changed(); }));
      } else header.append(el('strong', '', cell.title), el('span', 'tag', cell.locked ? 'Bloqueada' : 'Editable'));
      if (teacher || permissions.reorder) for (const delta of [-1, 1]) header.append(button(delta === -1 ? '↑' : '↓', () => { [cells[index], cells[index + delta]] = [cells[index + delta], cells[index]]; changed(); }, !canMove(cells, index, delta, teacher ? 'teacher' : 'student', permissions)));
      if (teacher || permissions.delete) header.append(button('Eliminar', () => { if (confirm('¿Eliminar esta celda?')) { cells.splice(index, 1); changed(); } }, !teacher && (cell.locked || cell.metadata?.deletable === false)));
      if (cell.type === 'code') header.append(button('Ejecutar celda', () => run([{ label: cell.title, payload: { mode: 'notebook', code: cell.code, filename: `celda_${index + 1}.py` } }]), false, false));
      article.append(header);
      const preview = el('div', 'activity-markdown');
      if (cell.type === 'markdown') renderMarkdown(preview, cell.code);
      if (teacher || !cell.locked || cell.type !== 'markdown') article.append(input(cell.code, `Contenido celda ${index + 1}`, value => { cell.code = value; if (cell.type === 'markdown') renderMarkdown(preview, value); }, true, !teacher && cell.locked));
      if (cell.type === 'markdown') article.append(preview); root.append(article);
    });
  }
  let project;
  if (activity.kind === 'files') {
    project = projectWorkspace(activity, answer);
    if (teacher) {
      activity.content.project = project;
      activity.content.exercises = activity.content.exercises.map(({ id, title, prompt }) => ({ id, title, prompt }));
    } else {
      answer.project = { files: project.files, entry: project.entry };
      delete answer.exercises;
    }
  }
  function filenameForm(title, initial, commit) {
    root.querySelector('.worksheet-filename-form')?.remove();
    const form = el('form', 'worksheet-toolbar worksheet-filename-form');
    const label = el('label', '', title), field = el('input', 'worksheet-input');
    field.setAttribute('aria-label', 'Nombre del archivo Python'); field.value = initial;
    field.placeholder = 'funciones.py'; field.required = true; field.pattern = '[A-Za-z_][A-Za-z0-9_]*\\.py';
    label.append(field);
    const submit = el('button', 'worksheet-mutate', 'Aceptar nombre'); submit.type = 'submit';
    form.append(label, submit, button('Cancelar nombre', () => form.remove(), false, false));
    form.onsubmit = event => { event.preventDefault(); if (!readonly) commit(field.value.trim()); };
    root.prepend(form); field.focus();
  }
  function exercises() {
    const originals = activity.content.exercises;
    if (!originals.length) return;
    exerciseIndex = Math.min(exerciseIndex, originals.length - 1);
    const original = originals[exerciseIndex], work = teacher ? project : answer.project;
    if (!Object.hasOwn(work.files, activeFile)) activeFile = work.entry;
    const nav = el('div', 'worksheet-toolbar');
    nav.append(button('← Anterior', () => { exerciseIndex--; render(); }, exerciseIndex === 0, false), select(originals.map((item, index) => [String(index), item.title]), String(exerciseIndex), 'Ejercicio actual', value => { exerciseIndex = Number(value); render(); }), button('Siguiente →', () => { exerciseIndex++; render(); }, exerciseIndex === originals.length - 1, false));
    if (teacher) nav.append(button('Agregar ejercicio', () => { const { id, title, prompt } = newExercise(); originals.push({ id, title, prompt }); exerciseIndex = originals.length - 1; changed(); }, originals.length >= 30), button('Eliminar ejercicio', () => { if (confirm('¿Eliminar este ejercicio del borrador?')) { originals.splice(exerciseIndex, 1); changed(); } }, originals.length <= 1));
    root.append(el('p', 'muted', 'Proyecto compartido: todos los ejercicios usan estos mismos archivos.'), nav);
    const prompt = el('div', 'activity-markdown'); renderMarkdown(prompt, original.prompt);
    if (teacher) root.append(input(original.title, 'Título del ejercicio', value => { original.title = value; }), input(original.prompt, 'Enunciado del ejercicio', value => { original.prompt = value; renderMarkdown(prompt, value); }, true));
    root.append(prompt);
    const tabs = el('div', 'worksheet-toolbar');
    for (const name of Object.keys(work.files)) { const tab = button(name + (project.lockedFiles.includes(name) ? ' 🔒' : ''), () => { activeFile = name; render(); }, false, false); tab.classList.toggle('selected', name === activeFile); tabs.append(tab); }
    tabs.append(button('Agregar archivo', () => filenameForm('Crear archivo', '', name => { if (!name) return; if (!filenameOK(name) || Object.hasOwn(work.files, name)) { notice('El nombre no es válido o ya existe.', true); return; } work.files[name] = ''; activeFile = name; changed(); }), Object.keys(work.files).length >= 600)); root.append(tabs);
    const controls = el('div', 'worksheet-toolbar'), locked = !teacher && project.lockedFiles.includes(activeFile);
    controls.append(el('span', '', 'Archivo principal'), select(Object.keys(work.files).map(name => [name, name]), work.entry, 'Archivo principal', name => { work.entry = name; onChange(); }, readonly));
    controls.append(button('Renombrar archivo', () => filenameForm('Renombrar archivo', activeFile, name => { if (!name) return; if (name === activeFile) { root.querySelector('.worksheet-filename-form')?.remove(); return; } if (!filenameOK(name) || Object.hasOwn(work.files, name)) { notice('Nombre no válido o ya existente.', true); return; } work.files[name] = work.files[activeFile]; delete work.files[activeFile]; if (work.entry === activeFile) work.entry = name; if (teacher) project.lockedFiles = project.lockedFiles.map(item => item === activeFile ? name : item); activeFile = name; changed(); }), locked));
    controls.append(button('Eliminar archivo', () => { if (!confirm(`¿Eliminar ${activeFile}?`)) return; delete work.files[activeFile]; if (teacher) project.lockedFiles = project.lockedFiles.filter(item => item !== activeFile); if (!Object.hasOwn(work.files, work.entry)) work.entry = Object.keys(work.files)[0]; activeFile = work.entry; changed(); }, locked || Object.keys(work.files).length <= 1));
    if (teacher) controls.append(button(project.lockedFiles.includes(activeFile) ? 'Desbloquear archivo' : 'Bloquear archivo', () => { project.lockedFiles = project.lockedFiles.includes(activeFile) ? project.lockedFiles.filter(name => name !== activeFile) : [...project.lockedFiles, activeFile]; changed(); }));
    controls.append(button('Ejecutar archivo actual', () => run([{ label: activeFile, payload: { mode: 'files', files: clone(work.files), entry: activeFile } }]), false, false));
    controls.append(button('Ejecutar principal', () => run([{ label: original.title, payload: { mode: 'files', files: clone(work.files), entry: work.entry } }]), false, false));
    root.append(controls, input(work.files[activeFile], `Código de ${activeFile}`, value => { work.files[activeFile] = value; }, true, locked));
  }
  function render() { root.replaceChildren(); if (activity.kind === 'notebook') notebook(); else exercises(); }
  render();
  return { render, syncControls() { root.querySelectorAll('[data-protected-disabled="true"]').forEach(el => { el.disabled = true; }); }, setReadonly(value) { readonly = value; render(); }, destroy() { root.replaceChildren(); } };
}
