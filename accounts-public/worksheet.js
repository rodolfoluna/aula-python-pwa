import { clone, createCell, canMove, newExercise, filenameOK, projectWorkspace } from '../dist/activity-model.js';
import { parseNotebook, exportNotebook } from '../dist/notebook.js';
import { renderMarkdown } from '../dist/markdown.js';
import { mountCodeEditor, withoutPythonComments } from './code-editor.js';

export function createWorksheet(root, options) {
  const { activity, answer, role, onChange = () => {}, run = () => {}, notice = () => {} } = options;
  const teacher = role === 'teacher'; let readonly = role === 'review' || options.readonly === true, exerciseIndex = 0, activeFile;
  let editors = [];
  const editorCache = new Map();
  const outputs = new Map(), outputViews = new Map();
  let kernelBusy = false;
  let guideOpen = true;
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
  function appendChunk(container, chunk) {
    if (chunk.kind === 'figure') { const img = el('img'); img.src = 'data:image/png;base64,' + chunk.data; img.alt = 'Gráfica de Python'; container.append(img); }
    else { const last = container.lastElementChild; if (last?.tagName === 'PRE' && last.className === chunk.channel) last.textContent += chunk.text; else container.append(el('pre', chunk.channel, chunk.text)); }
  }
  function paintOutput(id, rebuild = true) {
    const view = outputViews.get(id), state = outputs.get(id); if (!view || !state) return;
    view.section.hidden = false;
    view.state.textContent = `Salida [${state.execution ?? ' '}]: ${state.status}`;
    view.form.hidden = !state.input;
    if (rebuild) { view.content.replaceChildren(); state.chunks.forEach(chunk => appendChunk(view.content, chunk)); }
  }
  function receiveOutput(data) {
    const cells = teacher ? activity.content.cells : answer?.cells;
    if (activity.kind !== 'notebook' || !cells?.some(cell => cell.id === data.cellId && cell.type === 'code')) return;
    let state = outputs.get(data.cellId);
    if (data.kind === 'start' || !state) { state = { chunks: [], execution: data.execution, status: 'Ejecutando…', input: false }; outputs.set(data.cellId, state); }
    let chunk;
    if (data.kind === 'text' && typeof data.text === 'string') chunk = { kind: 'text', channel: ['stdout', 'stderr', 'stdin'].includes(data.channel) ? data.channel : 'stdout', text: data.text };
    if (data.kind === 'figure' && typeof data.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(data.data)) chunk = { kind: 'figure', data: data.data };
    if (chunk) state.chunks.push(chunk);
    if (data.kind === 'input') { state.input = true; state.status = 'Esperando tu respuesta…'; }
    if (data.kind === 'input-sent') { state.input = false; state.status = 'Ejecutando…'; }
    if (data.kind === 'done') { state.input = false; state.status = data.ok ? 'Ejecución terminada' : 'Error de ejecución'; }
    if (data.kind === 'settled' && /Ejecutando|Esperando/.test(state.status)) { state.input = false; state.status = 'Ejecución detenida'; }
    if (chunk && outputViews.has(data.cellId)) { appendChunk(outputViews.get(data.cellId).content, chunk); paintOutput(data.cellId, false); }
    else paintOutput(data.cellId);
    if (data.kind === 'input') outputViews.get(data.cellId)?.field.focus();
  }
  function syncKernelControls() { root.querySelectorAll('[data-kernel-action]').forEach(control => { control.disabled = control.dataset.kernelAction === 'stop' ? !kernelBusy : kernelBusy; }); }
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
    const task = (cell, index) => ({ cellId: cell.id, label: cell.title || `Celda ${index + 1}`, payload: { mode: 'notebook', code: cell.code, filename: `celda_${index + 1}.py` } });
    toolbar.append(button('Ejecutar todas', () => run(cells.map((cell, index) => cell.type === 'code' ? task(cell, index) : null).filter(Boolean)), false, false));
    for (const [action, label, callback] of [['stop', 'Detener', () => options.stop?.()], ['reset', 'Reiniciar memoria', () => options.reset?.()], ['clear', 'Limpiar salidas', () => { outputs.clear(); outputViews.forEach(view => { view.section.hidden = true; view.content.replaceChildren(); view.form.hidden = true; }); options.clear?.(); }]]) {
      const control = button(label, callback, false, false); control.dataset.kernelAction = action; toolbar.append(control);
    }
    toolbar.append(el('span', 'notebook-kernel-state', 'Consola Python')); root.append(toolbar);
    cells.forEach((cell, index) => {
      const article = el('article', 'worksheet-cell'), header = el('div', 'worksheet-toolbar');
      if (teacher) {
        header.append(input(cell.title, `Título celda ${index + 1}`, value => { cell.title = value; }), select([['code', 'Código'], ['markdown', 'Markdown'], ['raw', 'Texto raw']], cell.type, `Tipo celda ${index + 1}`, value => { cell.type = value; changed(); }, readonly));
        header.append(button(cell.locked ? 'Desbloquear' : 'Bloquear', () => { cell.locked = !cell.locked; changed(); }));
      } else header.append(el('strong', '', cell.title), el('span', 'tag', cell.locked ? 'Bloqueada' : 'Editable'));
      if (teacher || permissions.reorder) for (const delta of [-1, 1]) header.append(button(delta === -1 ? '↑' : '↓', () => { [cells[index], cells[index + delta]] = [cells[index + delta], cells[index]]; changed(); }, !canMove(cells, index, delta, teacher ? 'teacher' : 'student', permissions)));
      if (teacher || permissions.delete) header.append(button('Eliminar', () => { if (confirm('¿Eliminar esta celda?')) { cells.splice(index, 1); changed(); } }, !teacher && (cell.locked || cell.metadata?.deletable === false)));
      if (cell.type === 'code') header.append(button('Ejecutar celda', () => run([task(cell, index)]), false, false));
      article.append(header);
      const preview = el('div', 'activity-markdown');
      if (cell.type === 'markdown') renderMarkdown(preview, cell.code);
      if (teacher || !cell.locked || cell.type !== 'markdown') article.append(input(cell.code, `Contenido celda ${index + 1}`, value => { cell.code = value; if (cell.type === 'markdown') renderMarkdown(preview, value); }, true, !teacher && cell.locked));
      if (cell.type === 'markdown') article.append(preview); root.append(article);
      if (cell.type === 'code') {
        editors.push(mountCodeEditor(article.querySelector('.worksheet-code'), { cache: editorCache, cacheKey: cell.id, onSave: () => options.onSave?.(), onRun: () => run([task(cell, index)]) }));
        const section = el('section', 'cell-output'), state = el('div', 'cell-output-state'), content = el('div', 'cell-output-content'), form = el('form', 'cell-input-form'), field = el('input');
        section.hidden = true; section.setAttribute('aria-label', `Salida celda ${index + 1}`); section.setAttribute('role', 'region');
        const label = el('label', '', 'Tu programa espera una respuesta'); field.setAttribute('aria-label', `Entrada celda ${index + 1}`); field.autocomplete = 'off'; label.append(field);
        const send = el('button', '', 'Enviar respuesta'); send.type = 'submit'; form.append(label, send); form.hidden = true;
        form.onsubmit = event => { event.preventDefault(); if (new TextEncoder().encode(field.value).length > 65536) { notice('La entrada supera 64 KB.', true); return; } options.sendInput?.(field.value); };
        section.append(state, content, form); article.append(section); outputViews.set(cell.id, { section, state, content, form, field }); paintOutput(cell.id);
      }
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
    const overview = el('div', 'exercise-overview');
    overview.append(el('strong', 'exercise-counter', `Ejercicio ${exerciseIndex + 1} de ${originals.length}`), el('span', 'muted', 'Un solo proyecto · Archivos compartidos entre todos los ejercicios'));
    const exerciseList = el('div', 'exercise-list'); exerciseList.setAttribute('aria-label', 'Todos los ejercicios');
    originals.forEach((item, index) => { const itemButton = button(item.title, () => { exerciseIndex = index; render(); }, false, false); itemButton.setAttribute('aria-current', String(index === exerciseIndex)); itemButton.classList.toggle('selected', index === exerciseIndex); exerciseList.append(itemButton); });
    const guide = el('details', 'exercise-guide'); guide.open = guideOpen;
    guide.append(el('summary', '', 'Ejercicios y enunciado'), overview, nav, exerciseList); root.append(guide);
    const prompt = el('div', 'activity-markdown'); renderMarkdown(prompt, original.prompt);
    if (teacher) guide.append(input(original.title, 'Título del ejercicio', value => { original.title = value; }), input(original.prompt, 'Enunciado del ejercicio', value => { original.prompt = value; renderMarkdown(prompt, value); }, true));
    guide.append(prompt);
    const ide = el('section', 'project-ide'), explorer = el('aside', 'project-explorer'), pane = el('div', 'project-pane');
    explorer.append(el('h3', '', 'EXPLORADOR'), el('p', 'explorer-count', `${Object.keys(work.files).length} archivos en el proyecto`));
    const tabs = el('div', 'project-files');
    for (const name of Object.keys(work.files)) { const tab = button(name + (project.lockedFiles.includes(name) ? ' 🔒' : ''), () => { activeFile = name; render(); }, false, false); tab.title = name; tab.setAttribute('aria-pressed', String(name === activeFile)); tab.classList.toggle('selected', name === activeFile); tabs.append(tab); }
    explorer.append(tabs, button('Agregar archivo', () => filenameForm('Crear archivo', '', name => { if (!name) return; if (!filenameOK(name) || Object.hasOwn(work.files, name)) { notice('El nombre no es válido o ya existe.', true); return; } work.files[name] = ''; activeFile = name; changed(); }), Object.keys(work.files).length >= 600));
    const controls = el('div', 'worksheet-toolbar'), locked = !teacher && project.lockedFiles.includes(activeFile);
    let editor;
    const otherFiles = Object.keys(work.files).filter(name => name !== activeFile);
    controls.append(button('Insertar desde archivo', () => {
      if (root.querySelector('.worksheet-copy-form')) { root.querySelector('.worksheet-copy-form select').focus(); return; }
      const cursor = editor.getCursor(), form = el('form', 'worksheet-copy-form'), label = el('label', '', 'Archivo del que copiar');
      const source = select(otherFiles.map(name => [name, name]), otherFiles[0], 'Archivo del que copiar', () => {});
      label.append(source);
      const omitLabel = el('label', 'inline-label'), omit = el('input'); omit.type = 'checkbox'; omit.checked = true; omitLabel.append(omit, el('span', '', 'Omitir comentarios (#)'));
      const insert = el('button', '', 'Insertar código'); insert.type = 'submit';
      form.append(el('h4', '', 'Insertar código de otro archivo'), label, omitLabel, el('p', 'muted', 'Se insertará el código en la posición del cursor del archivo abierto. Los # dentro de cadenas de texto se conservan. El archivo de origen no cambia. Puedes deshacer con Ctrl+Z.'), insert, button('Cancelar copia', () => { form.remove(); editor.focus(); }));
      form.onsubmit = event => {
        event.preventDefault();
        if (readonly || locked || source.value === activeFile || !Object.hasOwn(work.files, source.value)) return;
        let text;
        try { text = omit.checked ? withoutPythonComments(work.files[source.value]) : work.files[source.value]; }
        catch { notice('No se pudo analizar este archivo. Desmarca «Omitir comentarios (#)» para insertar su contenido completo.', true); return; }
        if (work.files[activeFile].length + text.length > 100000) { notice('La inserción supera el límite de 100 000 caracteres del archivo. Reduce el código antes de copiar.', true); return; }
        if (editor.insertText(text, cursor)) form.remove();
      };
      controls.after(form); source.focus();
    }, locked || !otherFiles.length));
    controls.append(button('Renombrar archivo', () => filenameForm('Renombrar archivo', activeFile, name => { if (!name) return; if (name === activeFile) { root.querySelector('.worksheet-filename-form')?.remove(); return; } if (!filenameOK(name) || Object.hasOwn(work.files, name)) { notice('Nombre no válido o ya existente.', true); return; } work.files[name] = work.files[activeFile]; delete work.files[activeFile]; if (work.entry === activeFile) work.entry = name; if (teacher) project.lockedFiles = project.lockedFiles.map(item => item === activeFile ? name : item); activeFile = name; changed(); }), locked));
    controls.append(button('Eliminar archivo', () => { if (!confirm(`¿Eliminar ${activeFile}?`)) return; delete work.files[activeFile]; if (teacher) project.lockedFiles = project.lockedFiles.filter(item => item !== activeFile); if (!Object.hasOwn(work.files, work.entry)) work.entry = Object.keys(work.files)[0]; activeFile = work.entry; changed(); }, locked || Object.keys(work.files).length <= 1));
    if (teacher) controls.append(button(project.lockedFiles.includes(activeFile) ? 'Desbloquear archivo' : 'Bloquear archivo', () => { project.lockedFiles = project.lockedFiles.includes(activeFile) ? project.lockedFiles.filter(name => name !== activeFile) : [...project.lockedFiles, activeFile]; changed(); }));
    controls.append(button('Ejecutar', () => run([{ label: activeFile, payload: { mode: 'files', files: clone(work.files), entry: activeFile } }]), false, false));
    const filebar = el('div', 'editor-filebar'); filebar.append(el('strong', '', activeFile), el('span', '', 'Python'));
    const code = input(work.files[activeFile], `Código de ${activeFile}`, value => { work.files[activeFile] = value; }, true, locked);
    pane.append(filebar, code); ide.append(explorer, pane);
    root.append(el('p', 'editor-help', 'Ejecutar usa el archivo abierto. Ctrl+Espacio: sugerencias · Ctrl+F: buscar · Tab: sangría · Mayús+Enter: ejecutar · Ctrl+S: guardar. Esc y luego Tab permite salir del editor.'), controls, ide);
    editor = mountCodeEditor(code, { cache: editorCache, cacheKey: activeFile, onRun: () => run([{ label: activeFile, payload: { mode: 'files', files: clone(work.files), entry: activeFile } }]), onSave: () => options.onSave?.() }); editors.push(editor);
  }
  function render() { guideOpen = root.querySelector('.exercise-guide')?.open ?? guideOpen; editors.forEach(editor => editor.destroy()); editors = []; outputViews.clear(); root.replaceChildren(); if (activity.kind === 'notebook') notebook(); else exercises(); syncKernelControls(); }
  render();
  return { render, receiveOutput, setExecutionState(text, busy) { kernelBusy = busy; const label = root.querySelector('.notebook-kernel-state'); if (label) label.textContent = text; syncKernelControls(); }, syncControls() { root.querySelectorAll('[data-protected-disabled="true"]').forEach(el => { el.disabled = true; }); syncKernelControls(); }, setReadonly(value) { readonly = value; render(); }, destroy() { editors.forEach(editor => editor.destroy()); editors = []; outputs.clear(); outputViews.clear(); root.replaceChildren(); } };
}
