import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { OfflineWorkspace, indexedStore } from '../accounts-public/offline-store.js';
import { newActivity, initialAnswer } from '../dist/activity-model.js';
const html = await readFile(new URL('../accounts-public/index.html', import.meta.url), 'utf8');
async function idle(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('La interfaz no terminó de actualizarse.'); }
test('app arranca sin red, permite editar copia preparada y conserva avance al salir sin conexión', async () => {
  globalThis.indexedDB = new IDBFactory();
  const profile = { id: 'offline-student', role: 'student', name: 'Ana', must_change_password: false }, snapshot = newActivity();
  const data = { assignment: { id: 'one', snapshot, activity_version: 1 }, answer: initialAnswer(snapshot), revision: 0, writable: true };
  const workspace = new OfflineWorkspace(indexedStore());
  await workspace.prepare(profile, { configured: true, runnerOrigin: 'http://127.0.0.1:4173' }, { assignments: [{ id: 'one', title: 'Prueba offline', activity_version: 1 }] }, { groups: [{ name: 'Grupo offline' }] }, [data]);
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:4180' });
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, location: dom.window.location, localStorage: dom.window.localStorage, confirm: () => true });
  Object.defineProperty(dom.window.navigator, 'onLine', { value: false, configurable: true });
  const previousNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new TypeError('Offline'); };
  document.querySelector('dialog').close = () => {};
  try {
    await import('../accounts-public/app.js?offline-test');
    assert.equal(document.querySelector('#student-panel').hidden, false);
    assert.match(document.querySelector('#my-groups').textContent, /Grupo offline/);
    const open = [...document.querySelectorAll('button')].find(b => b.textContent === 'Abrir actividad'); open.click();
    await idle(() => document.querySelector('.worksheet-code'));
    const code = [...document.querySelectorAll('.worksheet-code')].find(el => !el.readOnly); code.value = 'valor=42'; code.dispatchEvent(new dom.window.Event('input'));
    assert.match(localStorage.getItem('aula-answer:offline-student:one'), /valor=42/);
    assert.equal(document.querySelector('#submit-answer').disabled, true);
    document.querySelector('#save-answer').click(); await idle(() => !document.querySelector('#login-submit').disabled);
    assert.match(document.querySelector('#answer-state').textContent, /este equipo/);
    document.querySelector('#logout').click(); await idle(() => !document.querySelector('#login-panel').hidden);
    assert.ok(localStorage.getItem('aula-answer:offline-student:one')); assert.equal(localStorage.getItem('aula-logout-pending'), '1');
    assert.equal(await workspace.store.get('active'), undefined);
  } finally { dom.window.close(); globalThis.fetch = originalFetch; Object.defineProperty(globalThis, 'navigator', { value: previousNavigator, configurable: true }); }
});
