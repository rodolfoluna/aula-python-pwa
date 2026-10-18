const equal = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
};
export function answerPatch(before, after) {
  const changes = [];
  function walk(a, b, path) {
    if (equal(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length || a.some((value, i) => value?.id !== b[i]?.id)) { changes.push({ path, value: b }); return; }
      a.forEach((value, i) => walk(value, b[i], [...path, String(i)])); return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const key of Object.keys(a)) if (!Object.hasOwn(b, key)) changes.push({ path: [...path, key], remove: true });
      for (const key of Object.keys(b)) { if (!Object.hasOwn(a, key)) changes.push({ path: [...path, key], value: b[key] }); else walk(a[key], b[key], [...path, key]); }
      return;
    }
    changes.push({ path, value: b });
  }
  walk(before, after, []); return { changes };
}
export function applyAnswerPatch(before, patch) {
  if (!patch || !Array.isArray(patch.changes) || patch.changes.length > 1024) throw new Error('Cambios inválidos.');
  let answer = structuredClone(before);
  for (const change of patch.changes) {
    if (!change || !Array.isArray(change.path) || change.path.length > 12 || change.path.some(key => typeof key !== 'string' || !key || key.length > 160 || ['__proto__', 'constructor', 'prototype'].includes(key)) ||
      (change.remove === true ? Object.hasOwn(change, 'value') : !Object.hasOwn(change, 'value'))) throw new Error('Ruta de cambios inválida.');
    if (!change.path.length) { if (change.remove) throw new Error('No se puede eliminar la respuesta.'); answer = structuredClone(change.value); continue; }
    let target = answer;
    for (const key of change.path.slice(0, -1)) { if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) throw new Error('Ruta de cambios inexistente.'); target = target[key]; }
    const key = change.path.at(-1);
    if (!target || typeof target !== 'object' || (Array.isArray(target) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= target.length || change.remove))) throw new Error('Ruta de cambios inválida.');
    if (change.remove) { if (!Object.hasOwn(target, key)) throw new Error('Ruta de cambios inexistente.'); delete target[key]; }
    else Object.defineProperty(target, key, { value: structuredClone(change.value), enumerable: true, writable: true, configurable: true });
  }
  return answer;
}
export const sameAnswer = equal;
