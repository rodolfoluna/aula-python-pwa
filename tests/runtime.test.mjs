import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

test('motor real: variables, input Unicode, PNG, módulos actualizados y detención', { timeout: 240000 }, async t => {
  const worker = new Worker(new URL('./worker-adapter.mjs', import.meta.url));
  const input = new SharedArrayBuffer(65544), control = new Int32Array(input, 0, 2), bytes = new Uint8Array(input, 8);
  const interrupt = new Uint8Array(new SharedArrayBuffer(1));
  const messages = [];
  let waiter, stdin = [], id = 0;
  worker.on('message', data => {
    messages.push(data);
    if (data.type === 'status') console.log(data.text);
    if (data.type === 'input' && stdin.length) {
      const value = new TextEncoder().encode(stdin.shift()); bytes.set(value); Atomics.store(control, 1, value.length); Atomics.store(control, 0, 1); Atomics.notify(control, 0);
    }
    if (data.type === 'fatal') waiter?.reject(new Error(data.text));
    if (waiter && waiter.predicate(data)) { const saved = waiter; waiter = null; saved.resolve(data); }
  });
  worker.on('error', error => waiter?.reject(error));
  function waitFor(predicate) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiter = null; reject(new Error('Tiempo de espera agotado')); }, 180000);
      waiter = { predicate, resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
    });
  }
  async function run(payload, inputs = []) {
    stdin = inputs; messages.length = 0; interrupt[0] = 0;
    const runId = ++id, done = waitFor(data => data.type === 'done' && data.id === runId);
    worker.postMessage({ type: 'run', id: runId, mode: 'notebook', filename: 'prueba.py', ...payload });
    const result = await done;
    return { ...result, text: messages.filter(m => m.type === 'text').map(m => m.text).join(''), figures: messages.filter(m => m.type === 'figure') };
  }
  try {
    const loaded = waitFor(data => data.type === 'ready');
    worker.postMessage({ type: 'init', input, interrupt: interrupt.buffer }); await loaded;
    assert.equal(messages.some(m => m.type === 'status' && /Matplotlib/.test(m.text)), false, 'El inicio básico no debe cargar gráficas');
    await t.test('comparte variables y objetos entre celdas', async () => {
      assert.equal((await run({ code: 'numeros = [10, 20]\nclass Alumno:\n    nombre = "Ana"\nalumno = Alumno()' })).ok, true);
      const result = await run({ code: 'numeros.append(30)\nprint(sum(numeros), alumno.nombre)' });
      assert.equal(result.ok, true); assert.match(result.text, /60 Ana/);
    });
    await t.test('input espera y reanuda con Unicode y líneas vacías', async () => {
      const result = await run({ code: 'nombre = input("Nombre: ")\nvacio = input("Vacío: ")\nprint(repr(nombre), repr(vacio))' }, ['José 🐍', '']);
      assert.equal(result.ok, true); assert.match(result.text, /José 🐍/); assert.match(result.text, /''/);
    });
    await t.test('gráficas se cargan al necesitarlas desde un módulo del proyecto', async () => {
      const result = await run({ mode: 'files', entry: 'main.py', files: {
        'main.py': 'import grafica', 'grafica.py': 'import matplotlib.pyplot as plt\nplt.plot([1,2],[3,4])'
      } });
      assert.equal(result.ok, true, result.text); assert.equal(result.figures.length, 1);
      assert.equal(messages.some(m => m.type === 'status' && m.loading === true), true);
      assert.equal(messages.some(m => m.type === 'status' && m.loading === false), true);
    });
    await t.test('Matplotlib genera una imagen PNG real', async () => {
      const result = await run({ code: 'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [2, 4, 1])\nplt.show()' });
      assert.equal(result.ok, true); assert.equal(result.figures.length, 1);
      assert.equal(Buffer.from(result.figures[0].data, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    });
    await t.test('ejecuta varios archivos y refresca módulos sin conservar variables', async () => {
      const files = { 'main.py': 'from utilidades import doble\nprint(doble(21))\ncontador = globals().get("contador", 0) + 1\nprint("contador", contador)', 'utilidades.py': 'def doble(x): return x * 2' };
      let result = await run({ mode: 'files', files, entry: 'main.py' }); assert.equal(result.ok, true); assert.match(result.text, /42/);
      files['utilidades.py'] = 'def doble(x): return x * 3';
      result = await run({ mode: 'files', files, entry: 'main.py' }); assert.equal(result.ok, true, result.text); assert.match(result.text, /63/); assert.match(result.text, /contador 1/);
    });
    await t.test('reporta errores sin destruir variables del notebook', async () => {
      const result = await run({ code: '1 / 0' }); assert.equal(result.ok, false); assert.match(result.text, /ZeroDivisionError/);
      assert.match((await run({ code: 'print(sum(numeros))' })).text, /60/);
    });
    await t.test('interrumpe bucle infinito y conserva la sesión utilizable', async () => {
      const resultPromise = run({ code: 'while True:\n    pass' });
      const timer = setTimeout(() => { interrupt[0] = 2; }, 500);
      const result = await resultPromise; clearTimeout(timer);
      assert.equal(result.ok, false); assert.match(result.text, /KeyboardInterrupt/);
      assert.match((await run({ code: 'print("recuperado")' })).text, /recuperado/);
    });
    await t.test('permite detener un programa que está esperando input()', async () => {
      const resultPromise = run({ code: 'input("Esperando: ")' });
      const timer = setTimeout(() => { interrupt[0] = 2; Atomics.notify(control, 0); }, 500);
      const result = await resultPromise; clearTimeout(timer);
      assert.equal(result.ok, false);
      assert.match((await run({ code: 'print("entrada recuperada")' })).text, /entrada recuperada/);
    });
  } finally { await worker.terminate(); }
});


test('Python preparado reinicia y ejecuta archivos, input y gráficas sin acceso a red', { timeout: 90000 }, async () => {
  // The preceding real-runtime test populated the package cache, as preparation does.
  const worker = new Worker(new URL('./worker-adapter.mjs', import.meta.url), { workerData: { offline: true } });
  const input = new SharedArrayBuffer(65544), interrupt = new SharedArrayBuffer(1), control = new Int32Array(input, 0, 2), bytes = new Uint8Array(input, 8);
  const messages = []; let waiter;
  worker.on('message', data => {
    messages.push(data);
    if (data.type === 'input') { const value = new TextEncoder().encode('Ana'); bytes.set(value); Atomics.store(control, 1, value.length); Atomics.store(control, 0, 1); Atomics.notify(control, 0); }
    if (data.type === 'fatal') waiter?.reject(new Error(data.text));
    if (data.type === waiter?.type) { const current = waiter; waiter = null; current.resolve(data); }
  });
  worker.on('error', error => waiter?.reject(error));
  const wait = type => new Promise((resolve, reject) => { waiter = { type, resolve, reject }; });
  try {
    const ready = wait('ready'); worker.postMessage({ type: 'init', input, interrupt }); await ready;
    const done = wait('done'); worker.postMessage({ type: 'run', id: 1, mode: 'files', entry: 'main.py', files: {
      'main.py': 'from auxiliar import valor\nnombre=input("Nombre: ")\nprint(nombre, valor)\nimport matplotlib.pyplot as plt\nplt.plot([1,2],[3,4])\nplt.show()',
      'auxiliar.py': 'valor=42'
    } });
    assert.equal((await done).ok, true, messages.filter(m => m.type === 'text').map(m => m.text).join(''));
    assert.match(messages.filter(m => m.type === 'text').map(m => m.text).join(''), /Ana 42/);
    assert.equal(messages.filter(m => m.type === 'figure').length, 1);
    assert.equal(messages.filter(m => m.type === 'network-attempt').length, 0);
  } finally { await worker.terminate(); }
});
