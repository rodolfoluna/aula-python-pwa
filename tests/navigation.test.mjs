import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createNavigation } from '../accounts-public/navigation.js';
async function move(window, action, ready) {
  const popped = new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }));
  action(); await popped;
  const start = Date.now();
  while (!ready()) { if (Date.now() - start > 5000) throw new Error('La navegación no terminó'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('Atrás y Adelante recorren secciones y respetan la pantalla inicial de la app', async () => {
  const dom = new JSDOM('', { url: 'https://aula.example/' }); let screen = 'home';
  const nav = createNavigation({ window: dom.window, canLeave: () => true }), { window } = dom;
  try {
    nav.reset('teacher', { key: 'home', restore: () => { screen = 'home'; } });
    screen = 'catalog'; nav.record('catalog', () => { screen = 'catalog'; });
    screen = 'editor'; nav.record('editor', () => { screen = 'editor'; });
    nav.record('saved-editor', () => { screen = 'saved-editor'; }, true);
    await move(window, () => window.history.back(), () => screen === 'catalog');
    await move(window, () => window.history.forward(), () => screen === 'saved-editor');
    await move(window, () => nav.back(), () => screen === 'catalog');
    await move(window, () => nav.back(), () => screen === 'home');
    await move(window, () => window.history.back(), () => window.history.state.index === 1);
    assert.equal(screen, 'home');
  } finally { nav.destroy(); window.close(); }
});

test('cancelar la salida conserva editor e historial; aceptar permite regresar', async () => {
  const dom = new JSDOM('', { url: 'https://aula.example/' }); let allowed = false, screen = 'home';
  const nav = createNavigation({ window: dom.window, canLeave: () => allowed }), { window } = dom;
  try {
    nav.reset('student', { key: 'home', restore: () => { screen = 'home'; } });
    screen = 'answer'; nav.record('answer', () => { screen = 'answer'; });
    await move(window, () => window.history.back(), () => window.history.state.index === 2);
    assert.equal(screen, 'answer');
    allowed = true; await move(window, () => nav.back(), () => screen === 'home');
    await move(window, () => window.history.forward(), () => screen === 'answer');
    assert.equal(window.history.state.index, 2);
  } finally { nav.destroy(); window.close(); }
});
