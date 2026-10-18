import { normalizeCell, permissionsFrom, DEFAULT_PERMISSIONS } from './notebook.js';
export const STORAGE_KEY = 'aula-python-lab-v1';
export const INPUT_CAPACITY = 65536;
export const validFilename = name => /^[A-Za-z_][A-Za-z0-9_]*\.py$/.test(name);
export function initialState() {
  return {
    cells: [
      { id: 'datos', title: 'Define tus datos', code: 'numeros = [12, 18, 9, 24, 16]\nnombre = "Mi grupo"\nprint("Datos preparados:", numeros)' },
      { id: 'variables', title: 'Reutiliza las variables', code: 'promedio = sum(numeros) / len(numeros)\nprint(f"Promedio de {nombre}: {promedio:.1f}")' },
      { id: 'entrada', title: 'Conversa con Python', code: 'estudiante = input("¿Cómo te llamas? ")\nprint(f"Hola, {estudiante}. El promedio es {promedio:.1f}.")' },
      { id: 'grafica', title: 'Visualiza el resultado', code: 'import matplotlib.pyplot as plt\n\nplt.bar(range(1, len(numeros) + 1), numeros, color="#168574")\nplt.axhline(promedio, color="#daaa55", linestyle="--", label="Promedio")\nplt.title(f"Resultados · {nombre}")\nplt.xlabel("Ejercicio")\nplt.ylabel("Puntaje")\nplt.legend()\nplt.show()' },
    ].map(normalizeCell),
    notebookTitle: 'Mi primer notebook', notebookMetadata: {}, permissions: { ...DEFAULT_PERMISSIONS }, studentCells: null,
    files: {
      'main.py': 'from utilidades import saludar, promedio\n\nnombre = input("¿Cómo te llamas? ")\nprint(saludar(nombre))\nprint("Promedio:", promedio([8, 9, 10]))',
      'utilidades.py': 'def saludar(nombre):\n    return f"Hola, {nombre}. ¡Los dos archivos funcionan!"\n\ndef promedio(valores):\n    return sum(valores) / len(valores)\n',
    },
    activeFile: 'main.py', entry: 'main.py',
  };
}
export function restoreState(raw) {
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value.cells) || value.cells.length > 100 || !value.cells.every(c => typeof c.id === 'string' && typeof c.title === 'string' && typeof c.code === 'string')) return initialState();
    if (new Set(value.cells.map(c => c.id)).size !== value.cells.length) return initialState();
    if (!value.cells.every(c => c.type === undefined || ['code', 'markdown', 'raw'].includes(c.type))) return initialState();
    if (!value.files || !Object.keys(value.files).length || !Object.entries(value.files).every(([name, code]) => validFilename(name) && typeof code === 'string')) return initialState();
    if (!Object.hasOwn(value.files, value.entry) || !Object.hasOwn(value.files, value.activeFile)) return initialState();
    return { ...value, cells: value.cells.map(normalizeCell), notebookTitle: typeof value.notebookTitle === 'string' ? value.notebookTitle : 'Mi primer notebook', notebookMetadata: value.notebookMetadata && typeof value.notebookMetadata === 'object' && !Array.isArray(value.notebookMetadata) ? value.notebookMetadata : {}, permissions: permissionsFrom(value.permissions), studentCells: Array.isArray(value.studentCells) && value.studentCells.length <= 100 && value.studentCells.every(c => typeof c.id === 'string' && typeof c.title === 'string' && typeof c.code === 'string' && ['code', 'markdown', 'raw'].includes(c.type)) ? value.studentCells.map(normalizeCell) : null };
  } catch { return initialState(); }
}
export function encodeInput(text) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > INPUT_CAPACITY) throw new Error('La respuesta supera 64 KB.');
  return bytes;
}
