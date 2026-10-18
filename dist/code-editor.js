export function bindCodeEditor(editor, onChange, save) {
  editor.addEventListener('input', () => { if (editor.disabled || editor.readOnly) return; onChange(editor.value); save(); });
  editor.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !editor.readOnly && !editor.disabled) {
      event.preventDefault();
      editor.setRangeText('    ', editor.selectionStart, editor.selectionEnd, 'end');
      onChange(editor.value); save();
    }
  });
}
