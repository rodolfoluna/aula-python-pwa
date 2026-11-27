import{test}from'node:test';
import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{Worker}from'node:worker_threads';
import{JSDOM}from'jsdom';
import{upgradeTopic45}from'../scripts/topic45-evaluation.mjs';
import{normalizeEvaluation,normalizeActivity,initialAnswer,validateAnswer}from'../dist/activity-model.js';
import{previewRuntime}from'../accounts-public/preview-runtime.js';
import{createLocalPreviewClient}from'../accounts-public/preview-wasm.js';
import{createWorksheet}from'../accounts-public/worksheet.js';
const module=await WebAssembly.compile(await readFile(new URL('../accounts-public'+previewRuntime.path,import.meta.url))),load=async()=>module;
function base(title){return{title,kind:'files',instructions:'Indicaciones originales.',content:{project:{entry:'ejercicio_1.py',files:Object.fromEntries(Array.from({length:12},(_,i)=>[i===11?'main.py':`ejercicio_${i+1}.py`,'# avance inicial intacto\n'])),lockedFiles:[]},exercises:Array.from({length:12},(_,i)=>({id:`e${String(i+1).padStart(2,'0')}`,title:`Ejercicio ${i+1}`,prompt:'Enunciado original.',file:i===11?'main.py':`ejercicio_${i+1}.py`}))}};}
async function simulate(program,inputs){const client=createLocalPreviewClient({load});let result=await client.request('start',{program}),output=result.output;for(const value of inputs){assert.equal(result.done,false);result=await client.request('input',{token:result.token,sequence:result.sequence+1,value:String(value)});output+=result.output;}assert.equal(result.done,true);return output;}
test('ambas plantillas conservan archivos y ejercicios: 24 vistas WebAssembly, 78 casos normalizados y respuestas compatibles',async()=>{
 for(const title of ['Ejercicios del tema 4_5','Problemario del tema 4_5']){
  const original=base(title),snapshot=structuredClone(original),updated=await upgradeTopic45(original,simulate);assert.deepEqual(original,snapshot);assert.deepEqual(updated.content.project,original.content.project);assert.deepEqual(updated.content.exercises.map(e=>[e.id,e.title,e.file]),original.content.exercises.map(e=>[e.id,e.title,e.file]));assert.equal(updated.content.exercises.reduce((sum,e)=>sum+e.evaluation.cases.length,0),39);assert.deepEqual(validateAnswer(updated,initialAnswer(updated)),initialAnswer(updated));
  for(const [index,exercise]of updated.content.exercises.entries()){
   assert.ok(exercise.prompt.startsWith('Enunciado original.'));assert.ok(exercise.evaluation.preview);assert.equal(exercise.evaluation.previewProgram,`${title.startsWith('Ejercicios')?'laundry':'tool-loans'}-${index+1}`);assert.deepEqual(normalizeEvaluation(exercise.evaluation),exercise.evaluation);
   if(index>=5&&index<=10)assert.ok(exercise.evaluation.cases.every(c=>c.checks));
  }
 }
 await assert.rejects(upgradeTopic45(base('Otra actividad'),simulate),/inesperada/);
});
test('las 24 vistas previas terminan con entradas propias adecuadas al ejercicio',async()=>{
 const inputs={laundry:[[],['Luz','Bolsa','Hoy'],['1',3.5,'0'],[1,'2',1,'1'],[0],[],['2',2.5],[100,'1',.1],['Ana','1',1,'0','0',0],['0'],['0'],['3','Ana','1',3.5,'0','0','3','Luis','2',2.5,'1','1','5','0']], 'tool-loans':[[],['Raúl','Martillo','Reparación'],['M',2],[1,'P','2',3],[0],[],['D'],[4,3,3],['Ana','M','1',1],['0'],['0'],['4','Ana','M','1',2,'4','Cora','D','2',3,'5',2,'7','0']]};
 for(const domain of ['laundry','tool-loans'])for(const[index,data]of inputs[domain].entries()){
  const output=await simulate(`${domain}-${index+1}`,data);
  if(domain==='laundry'&&index===6)assert.equal(output,'Subtotal: $75.00\n');
  if(domain==='laundry'&&index===7)assert.equal(output,'Total: $110.00\n');
  if(domain==='laundry'&&index===11)assert.match(output,/Total: \$145.50/);
  if(domain==='tool-loans'&&index===6)assert.equal(output,'Índice: 1\n');
  if(domain==='tool-loans'&&index===7)assert.equal(output,'Resultado: True\n');
  if(domain==='tool-loans'&&index===11){assert.match(output,/Devueltos: 1/);assert.match(output,/M \| Martillo \| Disponibles: 2 \| Pendientes: 2 \| Total controlado: 4/);}
 }
});
test('contratos rechazan código ejecutable y referencias inexistentes; el formato admite retorno None y salida vacía',()=>{
 const valid={preview:true,previewProgram:'laundry-8',cases:[{title:'Contrato',inputs:[],expected:'',match:'exact',checks:{fixtures:{values:[1,2]},calls:[{name:'sumar',args:[{ref:'values'}],expected:3,silent:true,unchanged:true}]}}]};
 assert.equal(normalizeEvaluation(valid).cases[0].checks.calls[0].expected,3);
 for(const mutate of [v=>v.cases[0].checks.calls[0].name='__import__',v=>v.cases[0].checks.calls[0].args=[{ref:'missing'}],v=>v.cases[0].checks.fixtures.values={code:'print(1)'},v=>v.previewProgram='laundry-13']){const invalid=structuredClone(valid);mutate(invalid);assert.throws(()=>normalizeEvaluation(invalid));}
});
test('UI conserva y explica contratos al editar plantillas; al alumno muestra pruebas sin solución y evalúa el archivo asociado',async()=>{
 const activity=await upgradeTopic45(base('Problemario del tema 4_5'),simulate),dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document});const root=document.querySelector('#root');let worksheet;
 try{
  worksheet=createWorksheet(root,{activity,role:'teacher'});const selector=root.querySelector('[aria-label="Ejercicio actual"]');selector.value='7';selector.dispatchEvent(new window.Event('change'));assert.ok(root.querySelector('[aria-label="Contrato de funciones (JSON) · caso 1"]'));const saved=normalizeActivity(activity);worksheet.destroy();
  const answer=initialAnswer(saved);let items;worksheet=createWorksheet(root,{activity:saved,answer,role:'student',run:jobs=>{items=jobs;return true;}});const select=root.querySelector('[aria-label="Ejercicio actual"]');select.value='7';select.dispatchEvent(new window.Event('change'));[...root.querySelectorAll('button')].find(b=>b.textContent==='main.py').click();[...root.querySelectorAll('button')].find(b=>b.textContent==='Autoevaluar ejercicio').click();assert.equal(items[0].payload.entry,'ejercicio_8.py');assert.equal(items[0].payload.test.checks.calls[0].name,'puede_prestar');assert.match(root.querySelector('.preview-examples').textContent,/retorno esperado/);assert.deepEqual(answer,initialAnswer(saved));
 }finally{worksheet?.destroy();dom.window.close();}
});
test('Python real offline comprueba retornos, defaults, inmutabilidad y captura; detecta implementaciones erróneas sin ejecutar el principal', {timeout:30000},async()=>{
 const worker=new Worker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{offline:true}}),messages=[];worker.on('message',m=>messages.push(m));let id=0;
 const wait=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>15000)throw Error('No respondió Python');await new Promise(r=>setTimeout(r,5));}};
 const run=async(code,checks,inputs=[],expected='')=>{const seq=++id;worker.postMessage({type:'run',id:seq,mode:'files',files:{'main.py':code},entry:'main.py',test:{title:'Contrato',inputs,expected,match:'exact',checks}});await wait(()=>messages.some(m=>m.type==='done'&&m.id===seq));return messages.find(m=>m.type==='evaluation'&&m.id===seq)?.result;};
 try{
  worker.postMessage({type:'init',input:new SharedArrayBuffer(65544),interrupt:new SharedArrayBuffer(1)});await wait(()=>messages.some(m=>m.type==='ready'));
  const calls={fixtures:{values:[1,2]},calls:[{name:'sumar',args:[{ref:'values'}],kwargs:{},expected:3,silent:true,unchanged:true}]};
  assert.equal((await run('def sumar(values):\n    total=0\n    for value in values: total+=value\n    return total\nwhile True: input("el principal no debe ejecutarse")',calls)).passed,true);
  for(const code of ['def sumar(values): return 4','def sumar(values): print(3)','def sumar(values):\n    print("no debe imprimir")\n    return 3','def sumar(values):\n    values[0]=99\n    return 3','def otra(values): return 3','def sumar(values): raise SystemExit()'])assert.equal((await run(code,calls)).passed,false,code);
  const defaultChecks={fixtures:{},calls:[{name:'puede',args:[4,3],expected:false,silent:true},{name:'puede',args:[4,3],kwargs:{limite:3},expected:true,silent:true}]};
  assert.equal((await run('def puede(stock,cantidad,limite=2): return 1<=cantidad<=limite and cantidad<=stock',defaultChecks)).passed,true);
  assert.equal((await run('def puede(stock,cantidad,limite=3): return 1<=cantidad<=limite and cantidad<=stock',defaultChecks)).passed,false);
  assert.equal((await run('def puede(stock,cantidad,limite=2): return 0',defaultChecks)).passed,false,'0 no es booleano False');
  const inputChecks={fixtures:{},calls:[{name:'leer',args:[],expected:'Ana'}]};assert.equal((await run('def leer():\n    value=input().strip()\n    while not value:\n        print("Texto no válido")\n        value=input().strip()\n    return value',inputChecks,['',' Ana '],'Texto no válido')).passed,true);
  const mutateChecks={fixtures:{stock:[4,3,2]},calls:[{name:'rechazar',args:[{ref:'stock'}],expected:-1,silent:true,unchanged:true}]};assert.equal((await run('def rechazar(stock):\n    stock[0]-=1\n    return -1',mutateChecks)).passed,false);
  assert.equal(messages.some(m=>m.type==='network-attempt'),false);
 }finally{await worker.terminate();}
});
