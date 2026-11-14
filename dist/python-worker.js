// Pinned runtime. No application credentials are ever sent to this worker.
const CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let py, notebook, interrupt, control, inputBytes, activeId, plotsReady = false;
let outputBytes = 0;
const send = (type, data = {}) => postMessage({ type, id: activeId, ...data });
function emitText(channel, text) {
  if (activeId === undefined) { send('diagnostic', { channel, text }); return; }
  outputBytes += text.length;
  if (outputBytes > 100000) throw new Error('Se alcanzó el límite de salida (100 000 caracteres).');
  send('text', { channel, text });
}

async function initialize(data) {
  interrupt = new Uint8Array(data.interrupt);
  control = new Int32Array(data.input, 0, 2);
  inputBytes = new Uint8Array(data.input, 8);
  send('status', { text: 'Descargando Python…' });
  const isNode = typeof process !== 'undefined' && process.versions?.node;
  const moduleURL = isNode ? 'pyodide' : CDN + 'pyodide.mjs';
  const { loadPyodide } = await import(moduleURL);
  py = await loadPyodide(isNode ? { packageCacheDir: process.cwd() + '/.runtime-cache/' } : { indexURL: CDN });
  py.setInterruptBuffer(interrupt);
  const decoder = new TextDecoder();
  py.setStdout({ write(buffer) { emitText('stdout', decoder.decode(buffer, { stream: true })); return buffer.length; }, isatty: true });
  const errorDecoder = new TextDecoder();
  py.setStderr({ write(buffer) { emitText('stderr', errorDecoder.decode(buffer, { stream: true })); return buffer.length; }, isatty: true });
  py.setStdin({ stdin() {
    Atomics.store(control, 0, 0);
    send('input');
    while (Atomics.load(control, 0) === 0) {
      Atomics.wait(control, 0, 0, 100);
      py.checkInterrupt();
    }
    return new TextDecoder().decode(inputBytes.slice(0, Atomics.load(control, 1)));
  }, isatty: true });
  py.registerJsModule('aula_bridge', { figure: data => send('figure', { data }) });
  notebook = py.runPython("{'__name__': '__main__'}");
  send('ready');
}

async function initializePlots() {
  send('status', { text: 'Preparando gráficas (Matplotlib)…', loading: true });
  await py.loadPackage('matplotlib', {
    messageCallback: text => send('diagnostic', { channel: 'info', text }),
    errorCallback: text => send('diagnostic', { channel: 'warning', text }),
  });
  py.runPython(`
import matplotlib
matplotlib.use('agg')
import matplotlib.pyplot as _aula_plt
import io as _aula_io
import base64 as _aula_base64
from aula_bridge import figure as _aula_figure

def _aula_show(*args, **kwargs):
    for number in _aula_plt.get_fignums():
        figure = _aula_plt.figure(number)
        buffer = _aula_io.BytesIO()
        figure.savefig(buffer, format='png', dpi=110, bbox_inches='tight')
        _aula_figure(_aula_base64.b64encode(buffer.getvalue()).decode('ascii'))
    _aula_plt.close('all')

_aula_plt.show = _aula_show
`);
  plotsReady = true;
  send('status', { text: 'Ejecutando Python…', loading: false });
}

// Test harness only: inputs and expected output, never a reference implementation.
const evaluationHarness = `
def _aula_evaluate(source, filename, inputs):
    import builtins, contextlib, io, json
    class LimitedOutput(io.StringIO):
        def write(self, value):
            if self.tell() + len(value) > 100000:
                raise RuntimeError('Se alcanzó el límite de salida')
            return super().write(value)
    output, errors = LimitedOutput(), LimitedOutput()
    position = 0
    def read_input(prompt=''):
        nonlocal position
        if position >= len(inputs):
            raise EOFError('El programa solicita más entradas de las previstas')
        value = inputs[position]
        position += 1
        return value
    original_input = builtins.input
    error = ''
    try:
        builtins.input = read_input
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            try:
                exec(compile(source, filename, 'exec'), {'__name__': '__main__', '__file__': filename})
            except SystemExit as stop:
                if stop.code not in (None, 0):
                    error = 'SystemExit: ' + str(stop.code)
            except BaseException as failure:
                error = type(failure).__name__ + ': ' + str(failure)
    finally:
        builtins.input = original_input
    return json.dumps({'output': output.getvalue(), 'error': error or errors.getvalue(), 'consumed': position})
`;
function checkEvaluation(test, result) {
  const lines = value => value.replaceAll('\r', '').split('\n').map(line => line.trim().replace(/[ \t]+/g, ' ')).filter(Boolean);
  const expected = lines(test.expected), actual = lines(result.output);
  let matches;
  if (test.match === 'exact') matches = JSON.stringify(expected) === JSON.stringify(actual);
  else { let cursor = 0; for (const line of actual) if (line === expected[cursor]) cursor++; matches = cursor === expected.length; }
  const forbidden = (test.absent || []).find(value => result.output.toLocaleLowerCase().includes(value.toLocaleLowerCase()));
  const passed = !result.error && result.consumed === test.inputs.length && matches && !forbidden;
  return { ...result, output: result.output.slice(0, 20000), passed, message: result.error ? 'El programa terminó con un error.' : result.consumed !== test.inputs.length ? `Se usaron ${result.consumed} de ${test.inputs.length} entradas previstas.` : forbidden ? `No debe aparecer: ${forbidden}` : !matches ? 'La salida no coincide con las líneas esperadas. Compara con la vista previa.' : 'Entradas y salida correctas.' };
}

async function execute(data) {
  outputBytes = 0;
  let temporary;
  try {
    // Inspect every project file, including helper modules imported by the entry point.
    // Basic exercises do not need to download or import the plotting stack.
    const sources = data.mode === 'files' ? Object.values(data.files) : [data.code];
    if (!data.test && !plotsReady && sources.some(code => /\b(?:matplotlib|pylab)\b/.test(code))) await initializePlots();
    activeId = data.id;
    if (data.mode === 'files') {
      const path = '/aula_project';
      // Remove bytecode and old files so imports always use the current editor text.
      py.runPython(`
import sys as _sys, shutil as _shutil, os as _os, importlib as _importlib
for _name, _module in list(_sys.modules.items()):
    if str(getattr(_module, '__file__', '')).startswith('/aula_project/'):
        del _sys.modules[_name]
_os.chdir('/')
_shutil.rmtree('/aula_project', ignore_errors=True)
_os.makedirs('/aula_project')
_os.chdir('/aula_project')
if '/aula_project' not in _sys.path:
    _sys.path.insert(0, '/aula_project')
_importlib.invalidate_caches()
`);
      for (const [name, code] of Object.entries(data.files)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*\.py$/.test(name)) throw new Error('Nombre de archivo no permitido.');
        py.FS.writeFile(`${path}/${name}`, code);
      }
      if (!Object.hasOwn(data.files, data.entry)) throw new Error('No existe el archivo principal.');
      temporary = py.runPython("{'__name__': '__main__'}");
      temporary.set('__file__', `${path}/${data.entry}`);
      if (data.test) {
        if (!Array.isArray(data.test.inputs) || data.test.inputs.length > 300 || typeof data.test.expected !== 'string') throw new Error('Caso de prueba inválido.');
        py.runPython(evaluationHarness, { globals: temporary });
        const evaluate = temporary.get('_aula_evaluate'), inputs = py.toPy(data.test.inputs);
        try { send('evaluation', { result: checkEvaluation(data.test, JSON.parse(evaluate(data.files[data.entry], `${path}/${data.entry}`, inputs))) }); }
        finally { evaluate.destroy(); inputs.destroy(); }
      } else py.runPython(data.files[data.entry], { globals: temporary, filename: data.entry });
    } else {
      py.runPython(data.code, { globals: notebook, filename: data.filename || '<exec>' });
    }
    // Also display figures created without an explicit show().
    if (plotsReady) py.runPython('_aula_show()');
    send('done', { ok: true });
  } catch (error) {
    activeId = data.id;
    if (data.test) send('evaluation', { result: { passed: false, output: '', error: String(error.message || error).slice(0, 20000), message: 'No se pudo completar la prueba.' } });
    send('text', { channel: 'stderr', text: String(error.message || error) + '\n' });
    send('done', { ok: false });
  } finally {
    temporary?.destroy();
    if (plotsReady) { try { py.runPython("_aula_plt.close('all')"); } catch {} }
    activeId = undefined;
  }
}
let initialized;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    initialized = initialize(data);
    try { await initialized; } catch (error) { send('fatal', { text: String(error.message || error) }); }
    return;
  }
  if (data.type === 'run') {
    try { await initialized; await execute(data); }
    catch (error) { send('fatal', { text: String(error.message || error) }); }
  }
};
