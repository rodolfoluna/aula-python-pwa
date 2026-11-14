import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Worker} from 'node:worker_threads';
import {normalizeActivity,initialAnswer,validateAnswer} from '../dist/activity-model.js';
import {createWorksheet} from '../accounts-public/worksheet.js';
import {redesignTopic3} from '../scripts/topic3-activity.mjs';
const testCase={title:'Duplicar',inputs:['21'],expected:'42',match:'exact',absent:[]};
function template(){return normalizeActivity({title:'Prueba',instructions:'',kind:'files',content:{project:{files:{'uno.py':'x=1','dos.py':'x=2','apoyo.py':'x=3'},entry:'uno.py',lockedFiles:[]},exercises:[{id:'uno',title:'Uno',prompt:'',file:'uno.py',evaluation:{preview:true,cases:[testCase]}},{id:'dos',title:'Dos',prompt:'',file:'dos.py'}]}});}
const press=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent===text).click();
const change=(root,label,value)=>{const f=root.querySelector(`[aria-label="${label}"]`);f.value=value;f.dispatchEvent(new window.Event('change'));};

test('asociaciones: cambiar ejercicio abre su archivo; explorar no cambia ejercicio; renombrado se guarda y recupera',()=>{
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,confirm:()=>true});
 const activity=template(),answer=initialAnswer(activity),root=document.querySelector('#root');let worksheet;
 try{
 worksheet=createWorksheet(root,{activity,answer,role:'student'});
 assert.ok(root.querySelector('[aria-label="Código de uno.py"]'));
 press(root,'apoyo.py');assert.equal(root.querySelector('[aria-label="Ejercicio actual"]').value,'0');
 press(root,'Siguiente →');assert.ok(root.querySelector('[aria-label="Código de dos.py"]'));
 press(root,'Renombrar archivo');root.querySelector('[aria-label="Nombre del archivo Python"]').value='nuevo.py';press(root,'Aceptar nombre');
 press(root,'← Anterior');press(root,'Siguiente →');assert.ok(root.querySelector('[aria-label="Código de nuevo.py"]'));
 const saved=validateAnswer(activity,answer);assert.equal(saved.project.exerciseFiles.dos,'nuevo.py');worksheet.destroy();
 worksheet=createWorksheet(root,{activity,answer:saved,role:'student'});press(root,'Siguiente →');assert.ok(root.querySelector('[aria-label="Código de nuevo.py"]'));
 press(root,'Eliminar archivo');assert.equal(Object.hasOwn(saved.project.files,'nuevo.py'),false);assert.doesNotThrow(()=>validateAnswer(activity,saved));
 press(root,'← Anterior');press(root,'Siguiente →');assert.ok(root.querySelector('[aria-label="Código de uno.py"]'));
 }finally{worksheet?.destroy();dom.window.close();}
});

test('autoevaluar usa el archivo asociado, conserva fuentes y presenta resultados y ejemplos sin código de solución',()=>{
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document});
 const activity=template(),answer=initialAnswer(activity),before=structuredClone(answer),root=document.querySelector('#root');let items,worksheet;
 try{
 worksheet=createWorksheet(root,{activity,answer,role:'student',run:jobs=>{items=jobs;return true;}});
 press(root,'apoyo.py');press(root,'Autoevaluar ejercicio');assert.equal(items[0].payload.entry,'uno.py');assert.deepEqual(items[0].payload.files,before.project.files);
 assert.deepEqual(answer,before);assert.match(root.querySelector('.solution-preview').textContent,/42/);assert.doesNotMatch(root.querySelector('.solution-preview').textContent,/x=1/);
 worksheet.receiveEvaluation({...items[0].evaluation,result:{passed:false,output:'41',message:'Revisar'}});assert.match(root.querySelector('.evaluation-status').textContent,/0\/1/);
 worksheet.receiveEvaluation({...items[0].evaluation,result:{passed:true,output:'42',message:'Correcto'}});assert.match(root.querySelector('.evaluation-status').textContent,/1\/1/);
 }finally{worksheet?.destroy();dom.window.close();}
});

test('profesor configura pruebas, asociaciones y renombrado sin perder metadatos al normalizar',()=>{
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document});const activity=template(),root=document.querySelector('#root');let worksheet;
 try{
 worksheet=createWorksheet(root,{activity,role:'teacher'});change(root,'Archivo asociado al ejercicio','dos.py');assert.equal(activity.content.exercises[0].file,'dos.py');
 press(root,'Renombrar archivo');root.querySelector('[aria-label="Nombre del archivo Python"]').value='nuevo.py';press(root,'Aceptar nombre');
 const saved=normalizeActivity(activity);assert.equal(saved.content.exercises[0].file,'nuevo.py');assert.equal(saved.content.exercises[1].file,'nuevo.py');assert.deepEqual(saved.content.exercises[0].evaluation.cases[0],testCase);
 const invalid=structuredClone(saved);invalid.content.exercises[0].file='ausente.py';assert.throws(()=>normalizeActivity(invalid),/asociado/);
 invalid.content.exercises[0].file='nuevo.py';invalid.content.exercises[0].evaluation.cases[0].inputs=null;assert.throws(()=>normalizeActivity(invalid),/prueba/);
 }finally{worksheet?.destroy();dom.window.close();}
});

test('tema 3 conserva ejercicios y archivos, define ocho asociaciones y pruebas sin referencia ejecutable',()=>{
 const base={title:'Ejercicios del tema 3',instructions:'Original',kind:'files',content:{project:{entry:'main.py',files:{'main.py':'# menú',...Object.fromEntries(Array.from({length:7},(_,i)=>[`ejercicio_${i+1}.py`,'# código inicial']))},lockedFiles:[]},exercises:Array.from({length:8},(_,i)=>({id:`e0${i+1}`,title:`Ejercicio ${i+1}`,prompt:'Original'}))}};
 const upgraded=normalizeActivity(redesignTopic3(base));assert.equal(upgraded.content.exercises.length,8);assert.deepEqual(upgraded.content.project,base.content.project);
 assert.equal(upgraded.content.exercises[7].file,'main.py');assert.ok(upgraded.content.exercises.every(e=>e.evaluation.preview&&e.evaluation.cases.length));assert.equal(base.content.exercises[0].evaluation,undefined);
 assert.throws(()=>redesignTopic3({...base,title:'Otra'}));
});

test('motor real offline: evalúa entrada/salida, errores, sobrantes, imports, aislamiento y bucles', {timeout:45000},async()=>{
 const worker=new Worker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{offline:true}}),input=new SharedArrayBuffer(65544),interrupt=new Uint8Array(new SharedArrayBuffer(1));let id=0;const messages=[];worker.on('message',m=>messages.push(m));
 const wait=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>20000)throw new Error('Worker no respondió: '+JSON.stringify(messages.slice(-3)));await new Promise(r=>setTimeout(r,10));}};
 const run=async(code,test=testCase,extra={})=>{const seq=++id;interrupt[0]=0;worker.postMessage({type:'run',id:seq,mode:'files',files:{'uno.py':code,...extra},entry:'uno.py',...(test?{test}:{})});await wait(()=>messages.some(m=>m.id===seq&&m.type==='done'));return messages.find(m=>m.id===seq&&m.type==='evaluation')?.result;};
 try{
 worker.postMessage({type:'init',input,interrupt:interrupt.buffer});await wait(()=>messages.some(m=>m.type==='ready'));
 assert.equal((await run('print(int(input("Número: "))*2)')).passed,true);
 assert.equal((await run('print(int(input())*3)')).passed,false);
 assert.match((await run('print(input());input()')).error,/EOFError/);
 assert.match((await run('print(42)')).message,/0 de 1/);
 assert.match((await run('1/0')).error,/ZeroDivisionError/);
 assert.equal((await run('from apoyo import doble\nprint(doble(int(input())))',testCase,{'apoyo.py':'def doble(n): return n*2'})).passed,true);
 assert.equal((await run('print("extra")\nprint(input())',{...testCase,expected:'21',match:'lines'})).passed,true);
 assert.equal((await run('print(input())\nprint("prohibido")',{...testCase,expected:'21',match:'lines',absent:['prohibido']})).passed,false);
 const pending=run('while True: pass');const timer=setTimeout(()=>{interrupt[0]=2;},500);assert.match((await pending).error,/KeyboardInterrupt/);clearTimeout(timer);
 await run('print("normal")',null);assert.ok(messages.some(m=>m.type==='text'&&m.text.includes('normal')));
 assert.equal((await run('print(int(input())*2)')).passed,true);
 assert.equal(messages.some(m=>m.type==='network-attempt'),false);
 }finally{await worker.terminate();}
});
