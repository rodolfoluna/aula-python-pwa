import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {setupActivities} from '../accounts-public/activities.js';

test('editor libre sin asignaciones: archivos locales por alumno, ejecución, portapapeles y recuperación sin guardar en API',async()=>{
 const dom=new JSDOM(await readFile(new URL('../accounts-public/index.html',import.meta.url),'utf8'),{url:'https://aula.test'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,localStorage:dom.window.localStorage,confirm:()=>true});
 let profile={id:'ana',role:'student',name:'Ana'},calls=[],jobs=[];
 const activities=setupActivities({api:async path=>{calls.push(path);if(path==='activities')return {assignments:[]};throw new Error('No debe subir archivos libres: '+path);},perform:fn=>fn(),getProfile:()=>profile,getGroups:()=>[],getRunnerOrigin:()=> 'https://runner.test'});
 const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
 try{
  await activities.setSession(profile);await button('Abrir editor libre').onclick();
  assert.equal(document.querySelector('.exercise-guide'),null);assert.equal(document.querySelector('#answer-controls').hidden,true);assert.equal(activities.current(),null);
  const field=document.querySelector('[aria-label="Código de main.py"]');field.value='from funciones import doble\nprint(doble(21))';field.dispatchEvent(new window.Event('input'));
  button('Agregar archivo').click();const name=document.querySelector('[aria-label="Nombre del archivo Python"]');name.value='funciones.py';button('Aceptar nombre').click();const module=document.querySelector('[aria-label="Código de funciones.py"]');module.value='def doble(n): return n*2';module.dispatchEvent(new window.Event('input'));
  const frame=document.querySelector('#runner-host iframe');frame.contentWindow.postMessage=data=>jobs.push(data);
  window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,origin:'https://runner.test',data:{type:'aula-ready',protocol:2}}));
  button('Ejecutar').click();assert.equal(jobs.at(-1).items[0].payload.entry,'funciones.py');assert.equal(jobs.at(-1).items[0].payload.files['main.py'],'from funciones import doble\nprint(doble(21))');
  const paste=new window.Event('paste',{cancelable:true,bubbles:true});module.dispatchEvent(paste);assert.equal(paste.defaultPrevented,false);
  const saved=JSON.parse(localStorage.getItem('aula-free-editor:ana'));assert.equal(saved.project.files['funciones.py'],'def doble(n): return n*2');assert.equal(Object.keys(localStorage).some(key=>key.startsWith('aula-answer:')),false);
  await activities.setSession(null);profile={id:'luis',role:'student'};await activities.setSession(profile);await button('Abrir editor libre').onclick();assert.equal(document.querySelectorAll('.project-files button').length,1);
  await activities.setSession(null);profile={id:'ana',role:'student'};await activities.setSession(profile);await button('Abrir editor libre').onclick();assert.equal(document.querySelectorAll('.project-files button').length,2);assert.match(document.querySelector('[aria-label="Código de main.py"]').value,/doble/);
  assert.ok(calls.every(path=>path==='activities'));
 }finally{await activities.setSession(null);dom.window.close();}
});

test('fallo de almacenamiento local del editor libre conserva el texto y bloquea salir o actualizar',async()=>{
 const dom=new JSDOM(await readFile(new URL('../accounts-public/index.html',import.meta.url),'utf8'),{url:'https://aula.test'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,localStorage:{getItem:()=>null,setItem:()=>{throw new Error('QuotaExceededError');}},confirm:()=>true});
 const profile={id:'ana',role:'student'},activities=setupActivities({api:async()=>({assignments:[]}),perform:fn=>fn(),getProfile:()=>profile,getGroups:()=>[],getRunnerOrigin:()=> 'https://runner.test'});
 try{await activities.setSession(profile);await document.querySelector('#open-free-editor').onclick();const code=document.querySelector('[aria-label="Código de main.py"]');code.value='NO_PERDER = 42';code.dispatchEvent(new window.Event('input'));assert.equal(activities.canReload(),false);assert.equal(activities.canLeave(),false);assert.equal(code.value,'NO_PERDER = 42');assert.match(document.querySelector('#free-editor-state').textContent,/No se pudo guardar/);}
 finally{await activities.setSession(null);dom.window.close();}
});
