import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { setupActivities } from '../accounts-public/activities.js';
import { newActivity, initialAnswer } from '../dist/activity-model.js';

test('el seguimiento consulta solo su pantalla visible, y se detiene al revisar código o volver al catálogo', async () => {
  const html = await readFile(new URL('../accounts-public/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://aula.example/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, localStorage: dom.window.localStorage, confirm: () => true });
  const originalInterval = globalThis.setInterval, originalNow = Date.now;
  let poll, now = originalNow(), reads = 0;
  Date.now = () => now;
  const profile = { id: 'teacher', role: 'teacher' }, snapshot = newActivity();
  const api = async path => {
    if (path === 'activities') return { activities: [], assignments: [{ id: 'assignment', title: 'Práctica' }] };
    if (path === 'activity-progress') { reads++; return { assignment: { id: 'assignment', due_at: null, closed: false }, token: String(reads), students: [{ id: 'student', control: '001', name: 'Ana' }] }; }
    if (path === 'activity-open') return { assignment: { id: 'assignment', activity_version: 1, snapshot }, answer: initialAnswer(snapshot), revision: 0, writable: false };
    throw new Error(path);
  };
  let activities;
  try {
    globalThis.setInterval = callback => { poll = callback; return { unref() {} }; };
    activities = setupActivities({ api, perform: action => action(), getGroups: () => [], getProfile: () => profile, getRunnerOrigin: () => 'https://python.example' });
    globalThis.setInterval = originalInterval;
    await activities.setSession(profile);
    await document.querySelector('#activities-nav').onclick();
    const action = text => [...document.querySelectorAll('button')].find(button => button.textContent === text).onclick();
    await action('Ver avances'); assert.equal(reads, 1);
    now += 300000; poll(); await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 2);
    await action('Ver último avance');
    now += 300000; poll(); document.dispatchEvent(new window.Event('visibilitychange'));
    await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 2);
    await document.querySelector('#activities-nav').onclick();
    now += 300000; poll(); document.dispatchEvent(new window.Event('visibilitychange'));
    await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 2);
  } finally { globalThis.setInterval = originalInterval; Date.now = originalNow; await activities?.setSession(null); dom.window.close(); }
});
