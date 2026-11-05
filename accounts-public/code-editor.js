import { EditorView, EditorState, basicSetup, python, oneDark, keymap, indentWithTab, historyField, indentUnit, Compartment, HighlightStyle, syntaxHighlighting, tags } from './vendor/code-editor.js';

let commentParser;
// Use Python's syntax tree so hashes in strings, including multiline strings,
// remain intact. Keep line breaks and indentation while removing comment tokens.
export function withoutPythonComments(code) {
  commentParser ||= python().language.parser;
  let result = '', position = 0;
  commentParser.parse(code).iterate({ enter(node) {
    if (node.name === 'Comment') { result += code.slice(position, node.from); position = node.to; }
  } });
  return result + code.slice(position);
}

const lightTheme = [EditorView.theme({
  '&': { backgroundColor: '#ffffff', color: '#203858' },
  '.cm-content': { caretColor: '#2563eb' },
  '.cm-cursor': { borderLeftColor: '#2563eb' },
  '.cm-activeLine': { backgroundColor: '#f0f5ff' },
  '.cm-activeLineGutter': { backgroundColor: '#e6eeff', color: '#2454a1' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#cbdcfc' },
  '.cm-tooltip': { backgroundColor: '#fff', color: '#203858', borderColor: '#cbd7ea' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#2563eb', color: '#fff' },
}), syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], color: '#7c3aed' },
  { tag: [tags.string, tags.special(tags.string)], color: '#147d48' },
  { tag: [tags.number, tags.bool, tags.null], color: '#b45309' },
  { tag: tags.comment, color: '#65758e', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.standard(tags.variableName)], color: '#1d4ed8' },
  { tag: [tags.className, tags.typeName], color: '#0e7490' },
]))];
const darkTheme = [EditorView.theme({
  '&': { backgroundColor: '#182235', color: '#dce5f5' },
  '.cm-activeLine': { backgroundColor: '#22324c' },
  '.cm-activeLineGutter': { backgroundColor: '#263c60', color: '#c7dcff' },
  '.cm-tooltip': { backgroundColor: '#202d43', color: '#dce5f5', borderColor: '#415572' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#3575eb', color: '#fff' },
}, { dark: true }), oneDark];

// Keep a plain field as a resilient fallback and a single source of truth for forms.
export function mountCodeEditor(field, { onRun = () => {}, onSave = () => {}, cache, cacheKey } = {}) {
  if (!field.ownerDocument.createRange().getClientRects) return {
    getCursor: () => field.selectionEnd,
    focus: () => field.focus(),
    insertText(text, at = field.selectionEnd) {
      if (field.readOnly || typeof text !== 'string') return false;
      at = Math.max(0, Math.min(field.value.length, at));
      field.setRangeText(text, at, at, 'end');
      field.dispatchEvent(new field.ownerDocument.defaultView.Event('input', { bubbles: true })); field.focus(); return true;
    },
    destroy() {}
  };
  const host = document.createElement('div'); host.className = 'python-editor';
  const status = document.createElement('div'); status.className = 'editor-status';
  const position = document.createElement('span'), language = document.createElement('span');
  language.textContent = `Python · UTF-8 · 4 espacios${field.readOnly ? ' · Solo lectura' : ''}`;
  status.append(position, language); field.after(host, status); field.hidden = true;
  const updatePosition = state => { const line = state.doc.lineAt(state.selection.main.head); position.textContent = `Lín. ${line.number}, col. ${state.selection.main.head - line.from + 1}`; };
  const theme = new Compartment();
  const currentTheme = () => document.documentElement.dataset.theme === 'dark' ? darkTheme : lightTheme;
  const config = { doc: field.value, extensions: [
    basicSetup, python(), theme.of(currentTheme()),
    EditorView.cspNonce.of(document.querySelector('meta[name="style-nonce"]')?.content || ''),
    EditorState.tabSize.of(4), indentUnit.of('    '), EditorState.readOnly.of(field.readOnly), EditorView.editable.of(!field.readOnly),
    EditorView.contentAttributes.of({ 'aria-label': field.getAttribute('aria-label'), 'aria-readonly': String(field.readOnly) }),
    keymap.of([{ key: 'Mod-s', run: () => { onSave(); return true; } }, { key: 'Shift-Enter', run: () => { onRun(); return true; } }, indentWithTab]),
    EditorView.updateListener.of(update => {
      if (update.docChanged) { field.value = update.state.doc.toString(); field.dispatchEvent(new field.ownerDocument.defaultView.Event('input', { bubbles: true })); }
      updatePosition(update.state);
    }),
  ] };
  const previous = cache?.get(cacheKey);
  const state = previous?.state.doc === field.value ? EditorState.fromJSON(previous.state, config, { history: historyField }) : EditorState.create(config);
  const view = new EditorView({ parent: host, state });
  const updateTheme = () => view.dispatch({ effects: theme.reconfigure(currentTheme()) });
  window.addEventListener('aula-theme-change', updateTheme);
  if (previous) view.scrollDOM.scrollTop = previous.scrollTop;
  const sync = () => { if (view.state.doc.toString() !== field.value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: field.value } }); };
  field.addEventListener('input', sync); updatePosition(view.state);
  return {
    getCursor: () => view.state.selection.main.head,
    focus: () => view.focus(),
    insertText(text, at = view.state.selection.main.head) {
      if (field.readOnly || view.state.readOnly || typeof text !== 'string') return false;
      at = Math.max(0, Math.min(view.state.doc.length, at));
      view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, scrollIntoView: true, userEvent: 'input.insertFromFile' });
      view.focus(); return true;
    },
    destroy() { cache?.set(cacheKey, { state: view.state.toJSON({ history: historyField }), scrollTop: view.scrollDOM.scrollTop }); window.removeEventListener('aula-theme-change', updateTheme); field.removeEventListener('input', sync); view.destroy(); host.remove(); status.remove(); }
  };
}
