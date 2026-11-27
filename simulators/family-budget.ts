// Authoring source. Only the stripped WebAssembly artifact is served to browsers.
const categories: string[] = ['Alimentación','Transporte','Otros'];
const guide = 'CONTROL DE GASTOS FAMILIARES\n1. Alimentación\n2. Transporte\n3. Otros\nAnota cada gasto una sola vez\nUsa pesos y punto decimal\nConsulta tu saldo antes de planear otra compra';
const menu = 'CONTROL DE GASTOS FAMILIARES\n1. Mostrar guía de categorías\n2. Simular una compra con el saldo actual\n3. Registrar un gasto\n4. Consultar historial\n5. Mostrar reporte del presupuesto\n0. Salir';
const budgetPrompt = 'Presupuesto de la familia (más de 0 y hasta 100000):';
const amountPrompt = 'Importe del gasto (más de 0 y hasta 10000):';
const categoryPrompt = 'Categoría: 1 Alimentación, 2 Transporte, 3 Otros';
let exercise: i32 = 0, stage: i32 = 0, count: i32 = 0, index: i32 = 0, category: i32 = 0;
let budget: f64 = 0, spent: f64 = 0;
let person = '', concept = '', prompt = '', output = '';
let done = false;
let concepts: string[] = [], groups: i32[] = [], amounts: f64[] = [];
let inputBytes = new ArrayBuffer(0), response = new ArrayBuffer(0);

function say(text: string): void { output += text + '\n'; }
function ask(text: string, next: i32): void { prompt = text; stage = next; }
function finish(): void { done = true; prompt = ''; stage = 0; }
export function money(value: f64): string {
  const bits = reinterpret<u64>(Math.abs(value));
  const exponent = i32((bits >> 52) & 2047);
  const fraction = bits & ((u64(1) << 52) - 1);
  const numerator = (exponent ? fraction + (u64(1) << 52) : fraction) * 100;
  const shift = 52 - (exponent ? exponent - 1023 : -1022);
  let rounded: u64 = 0;
  if (shift <= 0) rounded = numerator << -shift;
  else if (shift < 64) {
    rounded = numerator >> shift;
    const remainder = numerator & ((u64(1) << shift) - 1), half = u64(1) << (shift - 1);
    if (remainder > half || (remainder == half && (rounded & 1) != 0)) rounded++;
  }
  const decimals = (rounded % 100).toString();
  return '$' + ((reinterpret<u64>(value) >> 63) != 0 ? '-' : '') + (rounded / 100).toString() + '.' + (decimals.length < 2 ? '0' : '') + decimals;
}
export function number(text: string, integer: bool = false): f64 {
  const value = text.trim(); let i = 0, digits = 0;
  if (value.length && (value.charAt(0) == '+' || value.charAt(0) == '-')) i++;
  while (i < value.length && value.charCodeAt(i) >= 48 && value.charCodeAt(i) <= 57) { i++; digits++; }
  if (!integer && i < value.length && value.charAt(i) == '.') {
    i++; while (i < value.length && value.charCodeAt(i) >= 48 && value.charCodeAt(i) <= 57) { i++; digits++; }
  }
  if (!digits) return NaN;
  if (!integer && i < value.length && (value.charAt(i) == 'e' || value.charAt(i) == 'E')) {
    i++; if (i < value.length && (value.charAt(i) == '+' || value.charAt(i) == '-')) i++;
    const start = i; while (i < value.length && value.charCodeAt(i) >= 48 && value.charCodeAt(i) <= 57) i++;
    if (i == start) return NaN;
  }
  if (i != value.length) return NaN;
  const result = parseFloat(value); return isFinite(result) ? result : NaN;
}
function classify(balance: f64, projected: bool = false): void {
  if (balance > 0) say('Queda presupuesto disponible');
  else if (balance == 0) say('Presupuesto agotado');
  else { say('Presupuesto excedido'); say((projected ? 'Exceso proyectado: ' : 'Exceso: ') + money(-balance)); }
}
function detail(n: i32): string { return 'Gasto ' + (n+1).toString() + ': ' + concepts[n] + ' | ' + categories[groups[n]] + ' | ' + money(amounts[n]); }
function total(): f64 { let result: f64 = 0; for (let i = 0; i < amounts.length; i++) result += amounts[i]; return result; }
function history(): void { if (!amounts.length) say('Sin gastos registrados'); for (let i = 0; i < amounts.length; i++) say(detail(i)); }
function report(): void {
  const sum = total(); say('Cantidad: ' + amounts.length.toString()); say('Total: ' + money(sum));
  for (let c = 0; c < 3; c++) { let subtotal: f64 = 0; for (let i = 0; i < amounts.length; i++) if (groups[i] == c) subtotal += amounts[i]; say(categories[c] + ': ' + money(subtotal)); }
  say('Presupuesto: ' + money(budget)); say('Saldo: ' + money(budget-sum)); classify(budget-sum);
  if (amounts.length) { say('Promedio: ' + money(sum / amounts.length)); let largest = 0; for (let i = 1; i < amounts.length; i++) if (amounts[i] > amounts[largest]) largest = i;
    say('Mayor gasto: ' + (largest+1).toString() + ' | ' + concepts[largest] + ' | ' + categories[groups[largest]] + ' | ' + money(amounts[largest])); }
}
function showMenu(): void { say(menu); ask('Elige una opción:', 50); }
function askCount(): void { ask(exercise == 5 ? 'Cantidad de gastos (1 a 20):' : 'Cantidad de gastos (0 a 20):', 30); }
export function quote(text: string): string {
  let result = '"';
  for (let i = 0; i < text.length; i++) { const code = text.charCodeAt(i);
    if (code == 34) result += '\\"'; else if (code == 92) result += '\\\\'; else if (code == 10) result += '\\n'; else if (code == 13) result += '\\r'; else if (code == 9) result += '\\t';
    else if (code < 32) result += '\\u' + code.toString(16).padStart(4, '0'); else result += text.charAt(i);
  }
  return result + '"';
}
function encode(): void { response = String.UTF8.encode('{"output":' + quote(output) + ',"prompt":' + (done ? 'null' : quote(prompt)) + ',"done":' + (done ? 'true' : 'false') + '}'); }
export function init(program: i32): void {
  assert(program >= 1 && program <= 8); exercise = program; stage = 0; count = 0; index = 0; budget = 0; spent = 0; person = ''; concept = ''; prompt = ''; output = ''; done = false;
  concepts = []; groups = []; amounts = [];
  if (exercise == 1) { say(guide); finish(); }
  else if (exercise == 2) ask('Nombre de quien hizo el gasto:', 10);
  else if (exercise == 6) askCount();
  else ask(budgetPrompt, 20);
  encode();
}
export function allocInput(length: i32): usize { assert(length >= 0 && length <= 4000); inputBytes = new ArrayBuffer(length); return changetype<usize>(inputBytes); }
export function submit(length: i32): void {
  assert(!done && length >= 0 && length <= inputBytes.byteLength);
  const text = String.UTF8.decodeUnsafe(changetype<usize>(inputBytes), length); output = '';
  if (stage == 10) { person = text; ask('Concepto del gasto:', 11); }
  else if (stage == 11) { concept = text; ask('Fecha del gasto:', 12); }
  else if (stage == 12) { say('FICHA DE GASTO\nPersona: ' + person + '\nConcepto: ' + concept + '\nFecha: ' + text + '\nImporte pendiente de registrar'); finish(); }
  else if (stage == 20) {
    const value = number(text);
    if (!(value > 0 && value <= 100000)) { say('Presupuesto fuera de rango'); if (exercise == 3) finish(); }
    else { budget = value; if (exercise == 3 || exercise == 4) ask(amountPrompt, 21); else if (exercise == 8) showMenu(); else askCount(); }
  } else if (stage == 21) {
    const value = number(text);
    if (!(value > 0 && value <= 10000)) { say('Importe fuera de rango'); if (exercise == 3) finish(); }
    else { say('Presupuesto: ' + money(budget) + '\nGasto: ' + money(value) + '\nSaldo: ' + money(budget-value)); classify(budget-value); finish(); }
  } else if (stage == 30) {
    const value = number(text, true);
    if (!(value >= (exercise == 5 ? 1 : 0) && value <= 20)) say('Cantidad fuera de rango');
    else { count = i32(value); index = 0; spent = 0;
      if (!count) { history(); if (exercise == 7) report(); finish(); }
      else if (exercise == 5) { say('Gasto 1'); ask(amountPrompt, 31); }
      else ask('Concepto del gasto:', 40);
    }
  } else if (stage == 31) {
    const value = number(text);
    if (!(value > 0 && value <= 10000)) say('Importe fuera de rango');
    else { spent += value; index++;
      if (index < count) { say('Gasto ' + (index+1).toString()); ask(amountPrompt, 31); }
      else { say('Cantidad: ' + count.toString() + '\nPresupuesto: ' + money(budget) + '\nTotal: ' + money(spent) + '\nSaldo: ' + money(budget-spent)); classify(budget-spent); finish(); }
    }
  } else if (stage == 40) {
    if (!text.trim().length) say('Introduce un concepto no vacío'); else { concept = text; ask(categoryPrompt, 41); }
  } else if (stage == 41) {
    if (text != '1' && text != '2' && text != '3') say('Categoría no válida'); else { category = text.charCodeAt(0)-49; ask(amountPrompt, 42); }
  } else if (stage == 42) {
    const value = number(text);
    if (!(value > 0 && value <= 10000)) say('Importe fuera de rango');
    else { concepts.push(concept); groups.push(category); amounts.push(value); index++;
      if (exercise == 8) { say('Gasto registrado'); say(detail(amounts.length-1)); const balance = budget-total(); say('Saldo: ' + money(balance)); if (balance <= 0) classify(balance); showMenu(); }
      else if (index < count) ask('Concepto del gasto:', 40);
      else { history(); if (exercise == 7) report(); finish(); }
    }
  } else if (stage == 50) {
    if (text == '0') { say('Hasta pronto'); finish(); }
    else if (text == '1') { say(guide); showMenu(); }
    else if (text == '2') ask(amountPrompt, 51);
    else if (text == '3') { if (amounts.length >= 20) { say('Capacidad de registros alcanzada'); showMenu(); } else ask('Concepto del gasto:', 40); }
    else if (text == '4') { history(); showMenu(); }
    else if (text == '5') { report(); showMenu(); }
    else { say('Opción no válida'); showMenu(); }
  } else if (stage == 51) {
    const value = number(text);
    if (!(value > 0 && value <= 10000)) say('Importe fuera de rango');
    else { const balance = budget-total(); say('Saldo actual: ' + money(balance) + '\nPropuesta: ' + money(value) + '\nSaldo proyectado: ' + money(balance-value)); classify(balance-value, true); showMenu(); }
  }
  encode();
}
export function resultPointer(): usize { return changetype<usize>(response); }
export function resultLength(): i32 { return response.byteLength; }
