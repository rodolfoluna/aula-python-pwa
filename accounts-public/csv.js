export function normalizeStudent(value) {
  const control = String(value.control ?? '').trim().toUpperCase();
  const name = String(value.name ?? '').trim().replace(/\s+/g, ' ');
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(control)) throw new Error('Número de control inválido: usa de 1 a 32 letras, números, guion o guion bajo.');
  if (!name || name.length > 160) throw new Error('El nombre debe tener entre 1 y 160 caracteres.');
  return { control, name };
}
function parseRows(text) {
  const first = text.split(/\r?\n/)[0];
  const separator = first.includes(';') && !first.includes(',') ? ';' : ',';
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === '"') {
      if (field.length || closed) throw new Error('CSV con comillas mal colocadas.');
      quoted = true;
    } else if (char === separator) { row.push(field); field = ''; closed = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(value => value.trim())) rows.push(row);
      row = []; field = ''; closed = false;
    } else { if (closed && char.trim()) throw new Error('CSV con texto después de cerrar comillas.'); if (!closed) field += char; }
  }
  if (quoted) throw new Error('CSV con comillas sin cerrar.');
  row.push(field); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}
export function previewCsv(text, existingControls = []) {
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error('El CSV supera 1 MB.');
  const rows = parseRows(text.replace(/^\uFEFF/, ''));
  if (!rows.length) throw new Error('El archivo está vacío.');
  const headers = rows.shift().map(value => value.trim().toLowerCase());
  const controlIndex = headers.indexOf('numero_control'), nameIndex = headers.indexOf('nombre');
  if (controlIndex < 0 || nameIndex < 0 || new Set(headers).size !== headers.length) throw new Error('Se requieren encabezados únicos: numero_control,nombre.');
  if (rows.length > 500) throw new Error('Importa como máximo 500 alumnos por archivo.');
  const seen = new Set(existingControls.map(value => value.toUpperCase()));
  return rows.map((row, index) => {
    const result = { line: index + 2, control: row[controlIndex] || '', name: row[nameIndex] || '' };
    try {
      if (row.length !== headers.length) throw new Error('Cantidad de columnas incorrecta.');
      Object.assign(result, normalizeStudent(result));
      if (seen.has(result.control)) throw new Error('Número de control duplicado o ya registrado.');
      seen.add(result.control); return { ...result, valid: true };
    } catch (error) { return { ...result, valid: false, error: error.message }; }
  });
}
export function credentialsCsv(records) {
  const quote = value => { const text = String(value ?? ''); return '"' + (/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"'; };
  return '\uFEFF' + [['numero_control', 'nombre', 'clave_temporal'], ...records.map(row => [row.control, row.name, row.password])].map(row => row.map(quote).join(',')).join('\r\n');
}
