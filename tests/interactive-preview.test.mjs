import{test}from'node:test';
import assert from'node:assert/strict';
import{JSDOM}from'jsdom';
import{createPreviewProgram,money}from'../accounts/preview-programs.mjs';
import{createPreviewService}from'../accounts/preview-service.mjs';
import{redesignTopic3,enableInteractiveTopic3}from'../scripts/topic3-activity.mjs';
import{normalizeActivity,initialAnswer}from'../dist/activity-model.js';
import{createWorksheet}from'../accounts-public/worksheet.js';
import{createAccountsServer}from'../accounts/server.mjs';
import{memoryAccountStore}from'./helpers/account-store.mjs';
function topic(){return normalizeActivity(redesignTopic3({title:'Ejercicios del tema 3',kind:'files',instructions:'Original',content:{project:{entry:'main.py',files:{'main.py':'# menú',...Object.fromEntries(Array.from({length:7},(_,i)=>[`ejercicio_${i+1}.py`,'# propio']))},lockedFiles:[]},exercises:Array.from({length:8},(_,i)=>({id:`e0${i+1}`,title:`Ejercicio ${i+1}`,prompt:'Original'}))}}));}
function simulate(index,inputs){const program=createPreviewProgram('family-budget-'+index);let response=program.advance(),output=response.output;for(const input of inputs){assert.equal(response.done,false,'La demostración no debe terminar antes de consumir las entradas');response=program.advance(String(input));output+=response.output;}return{...response,output};}
const lines=value=>value.trim().split('\n').map(s=>s.trim()).filter(Boolean);
test('referencias privadas: los 30 casos del tema 3 coinciden, incluidos menú, validaciones, capacidad y simulaciones',()=>{
 let count=0;for(const[index,exercise]of topic().content.exercises.entries())for(const test of exercise.evaluation.cases){const result=simulate(index+1,test.inputs);assert.equal(result.done,true,test.title);if(test.match==='exact')assert.deepEqual(lines(result.output),lines(test.expected),test.title);else{let cursor=0,expected=lines(test.expected);for(const line of lines(result.output))if(line===expected[cursor])cursor++;assert.equal(cursor,expected.length,test.title);}for(const absent of test.absent)assert.ok(!result.output.includes(absent));count++;}assert.equal(count,30);
});
test('datos propios, texto inválido, empate y formato monetario compatibles con Python',()=>{
 assert.equal(money(0.125),'$0.12');assert.equal(money(0.375),'$0.38');assert.equal(money(2.675),'$2.67');assert.equal(money(-25),'$-25.00');
 const result=simulate(7,['hola',300,2,'Transporte privado',2,40,'Cena',1,40]);assert.match(result.output,/Presupuesto fuera de rango/);assert.match(result.output,/Saldo: \$220.00/);assert.match(result.output,/Mayor gasto: 1 \| Transporte privado \| Transporte \| \$40.00/);
 assert.match(simulate(2,['Luz','Compra <propia>','Hoy']).output,/Persona: Luz\nConcepto: Compra <propia>\nFecha: Hoy/);
 assert.equal(simulate(3,[0]).done,true);
 const original=topic(),updated=enableInteractiveTopic3(original);assert.deepEqual(updated.content.project,original.content.project);assert.deepEqual(updated.content.exercises.map(e=>e.evaluation.cases),original.content.exercises.map(e=>e.evaluation.cases));assert.match(updated.instructions,/requiere conexión/);
});
test('sesiones de demostración: permisos, reintento idempotente, orden, aislamiento, caducidad y ninguna escritura',async()=>{
 let now=1000,reads=0;const template=topic(),teacher={id:'teacher',role:'teacher'},student={id:'student',role:'student'};
 const store={activity:async()=>{reads++;return{...template,teacher_id:'teacher'};},assignment:async()=>{reads++;return{teacher_id:'teacher',group_id:'group',snapshot:template};},membership:async(g,id)=>{reads++;return id==='student'?{}:null;}};
 const service=createPreviewService(store,()=>now),session={},other={};
 await assert.rejects(service.start({...student,id:'stranger'},other,{assignmentId:'assigned',exerciseId:'e02'}),/sin acceso/);
 await assert.rejects(service.start(student,session,{activityId:'template',exerciseId:'e02'}),/sin acceso/);
 let result=await service.start(student,session,{assignmentId:'assigned',exerciseId:'e02'});const before=reads,token=result.token;
 assert.throws(()=>service.input(other,{token,sequence:1,value:'Ana'}),/caducó/);
 const first={token,sequence:1,value:'Noelia'};result=service.input(session,first);assert.deepEqual(service.input(session,first),result);
 assert.throws(()=>service.input(session,{...first,value:'Otro'}),/cambió/);
 assert.throws(()=>service.input(session,{token,sequence:3,value:'Fuera de orden'}),/cambió/);
 service.input(session,{token,sequence:2,value:'Helado'});result=service.input(session,{token,sequence:3,value:'Hoy'});assert.match(result.output,/Noelia/);assert.equal(result.done,true);assert.equal(reads,before,'Las entradas no consultan ni escriben en Supabase');
 result=await service.start(teacher,session,{activityId:'template',exerciseId:'e01'});assert.equal(result.done,true);now+=15*60*1000;assert.throws(()=>service.input(session,{token:result.token,sequence:1,value:''}),/caducó/);
});
test('consola interactiva conserva el proyecto, texto propio y sesión al cambiar archivos; permite reiniciar',async()=>{
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document});const activity=topic(),answer=initialAnswer(activity),before=structuredClone(answer),root=document.querySelector('#root');let program,sequence=0;const calls=[];
 const preview=async(action,data)=>{calls.push({action,data});if(action==='start'){program=createPreviewProgram('family-budget-2');sequence=0;}return{token:'opaque',sequence:action==='start'?0:++sequence,...program.advance(action==='input'?data.value:undefined)};};
 const worksheet=createWorksheet(root,{activity,answer,role:'student',preview});const button=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);const flush=()=>new Promise(r=>setImmediate(r));
 try{
 const select=root.querySelector('[aria-label="Ejercicio actual"]');select.value='1';select.dispatchEvent(new window.Event('change'));button('Iniciar demostración').click();await flush();
 const enter=async value=>{const field=root.querySelector('[aria-label="Dato para la demostración"]');field.value=value;field.dispatchEvent(new window.Event('input'));root.querySelector('.preview-input-form').dispatchEvent(new window.Event('submit',{cancelable:true}));await flush();};
 await enter('Elena');let field=root.querySelector('[aria-label="Dato para la demostración"]');field.value='Cena <script>';field.dispatchEvent(new window.Event('input'));button('main.py').click();assert.equal(root.querySelector('[aria-label="Dato para la demostración"]').value,'Cena <script>');await enter('Cena <script>');await enter('15 de noviembre');assert.match(root.querySelector('.preview-console').textContent,/Persona: Elena/);assert.match(root.querySelector('.preview-console').textContent,/Concepto: Cena <script>/);assert.equal(root.querySelectorAll('script').length,0);assert.equal(root.querySelector('.preview-input-form').hidden,true);assert.deepEqual(answer,before);
 button('Reiniciar demostración').click();await flush();assert.equal(root.querySelector('.preview-input-form').hidden,false);assert.doesNotMatch(root.querySelector('.preview-console').textContent,/Elena/);assert.equal(calls.filter(c=>c.action==='start').length,2);
 }finally{worksheet.destroy();dom.window.close();}
});
test('API publicada: autenticación y CSRF, referencia inaccesible y respuestas sin código ni cambios en trabajos',async()=>{
 const store=memoryAccountStore(),teacher=await store.createUser({email:'preview@example.com',password:'SoloPrueba1234',role:'teacher',name:'Profesor'}),group=await store.createGroup(teacher.id,'Prueba'),template=await store.createActivity(teacher.id,topic());
 const student=await store.createUser({email:'student@example.com',password:'SoloPrueba1234',role:'student',teacherId:teacher.id,control:'PREVIEW',name:'Alumno'});await store.updateProfile(student.id,{must_change_password:false});await store.setMembership(group.id,student.id,true);const[assignment]=await store.createAssignments([{activity_id:template.id,teacher_id:teacher.id,group_id:group.id,activity_version:1,snapshot:topic()}]);
 const server=createAccountsServer({store});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;let cookie;
 const post=(path,data,origin=base)=>fetch(base+'/api/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
 try{
 assert.equal((await post('preview-start',{assignmentId:assignment.id,exerciseId:'e02'})).status,401);
 const login=await post('login',{login:'student@example.com',password:'SoloPrueba1234'});cookie=login.headers.get('set-cookie').split(';')[0];assert.equal(login.status,200);
 assert.equal((await post('preview-start',{assignmentId:assignment.id,exerciseId:'e02'},'http://otro.example')).status,403);
 const start=await post('preview-start',{assignmentId:assignment.id,exerciseId:'e02'});assert.equal(start.status,200);let response=await start.json();assert.deepEqual(Object.keys(response).sort(),['done','output','prompt','sequence','token']);
 for(const[sequence,value]of ['Ariadna','Pan','Hoy'].entries()){const next=await post('preview-input',{token:response.token,sequence:sequence+1,value});assert.equal(next.status,200);response=await next.json();}
 assert.match(response.output,/Persona: Ariadna/);assert.equal(await store.submission(assignment.id,student.id),undefined);
 for(const path of ['/accounts/preview-programs.mjs','/accounts/preview-service.mjs','/scripts/topic3-activity.mjs'])assert.equal((await fetch(base+path)).status,404);
 assert.equal((await fetch(base+'/interactive-preview.js')).status,200);
 }finally{await new Promise(r=>server.close(r));}
});
