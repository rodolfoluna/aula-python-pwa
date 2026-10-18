import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, restoreState, encodeInput, validFilename } from '../dist/model.js';
import { createServer } from '../server.mjs';

test('recupera código y archivos, y tolera almacenamiento dañado', () => {
  const state = initialState();
  state.cells[0].code = 'valor = 42';
  assert.deepEqual(restoreState(JSON.stringify(state)), state);
  for (const raw of ['{', '{}', 'null', JSON.stringify({ ...state, entry: 'no_existe.py' })]) assert.deepEqual(restoreState(raw), initialState());
});
test('nombres seguros y respuestas Unicode para input()', () => {
  assert.ok(validFilename('utilidades_2.py'));
  for (const name of ['../main.py', 'a/b.py', 'main.js', '__proto__', '']) assert.equal(validFilename(name), false);
  assert.equal(new TextDecoder().decode(encodeInput('José 🐍')), 'José 🐍');
  assert.throws(() => encodeInput('x'.repeat(65537)));
});
test('servidor entrega aislamiento para SharedArrayBuffer y no publica archivos del proyecto', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.match(await response.text(), /Aula Python/);
    assert.equal((await fetch(base + '/package.json')).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
