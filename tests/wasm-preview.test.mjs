import{test}from'node:test';
import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{createLocalPreviewClient,createPreviewRuntimeLoader}from'../accounts-public/preview-wasm.js';
import{previewRuntime}from'../accounts-public/preview-runtime.js';
import{createPreviewProgram}from'../accounts/preview-programs.mjs';
import{redesignTopic3}from'../scripts/topic3-activity.mjs';
const bytes=await readFile(new URL('../accounts-public'+previewRuntime.path,import.meta.url)),module=await WebAssembly.compile(bytes),load=async()=>module;
const topic=()=>redesignTopic3({title:'Ejercicios del tema 3',kind:'files',instructions:'Original',content:{project:{entry:'main.py',files:{'main.py':'# menú',...Object.fromEntries(Array.from({length:7},(_,i)=>[`ejercicio_${i+1}.py`,'# propio']))},lockedFiles:[]},exercises:Array.from({length:8},(_,i)=>({id:`e0${i+1}`,title:`Ejercicio ${i+1}`,prompt:'Original'}))}});
async function compare(program,inputs){const client=createLocalPreviewClient({load}),reference=createPreviewProgram(program);let result=await client.request('start',{program}),expected=reference.advance();assert.deepEqual({output:result.output,prompt:result.prompt,done:result.done},expected);for(const value of inputs){assert.equal(result.done,false);result=await client.request('input',{token:result.token,sequence:result.sequence+1,value:String(value)});expected=reference.advance(String(value));assert.deepEqual({output:result.output,prompt:result.prompt,done:result.done},expected,program+' entrada '+value);}return result;}
test('WebAssembly real: 30 casos coinciden paso a paso con la referencia y no contienen símbolos ni fuentes',async()=>{
 assert.equal(createHash('sha256').update((await readFile(new URL('../simulators/family-budget.ts',import.meta.url),'utf8')).replaceAll('\r\n','\n')).digest('hex'),previewRuntime.sourceSha256);assert.deepEqual(WebAssembly.Module.imports(module),[{module:'env',name:'abort',kind:'function'}]);assert.equal(bytes.length,previewRuntime.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),previewRuntime.sha256);assert.deepEqual([...bytes.subarray(0,4)],[0,97,115,109]);for(const section of ['name','sourceMappingURL','sourceURL'])assert.equal(WebAssembly.Module.customSections(module,section).length,0);assert.ok(!bytes.includes(Buffer.from('function money')));assert.ok(!bytes.includes(Buffer.from('function* program')));
 let count=0;for(const[index,exercise]of topic().content.exercises.entries())for(const test of exercise.evaluation.cases){assert.equal((await compare('family-budget-'+(index+1),test.inputs)).done,true);count++;}assert.equal(count,30);
});
test('datos nuevos y redondeos: UTF-8, importes aleatorios, texto inválido y empates de centavos',async()=>{
 await compare('family-budget-2',['María 🐍','Cena "familiar" \\ <script>\t','sábado']);
 await compare('family-budget-7',[1,2,'Uno',1,'.10','Dos',2,'.15']);
 await compare('family-budget-7',[100,2,'Uno',1,'5.34','Dos',2,'.01']);
 await compare('family-budget-4',['NaN','Infinity','1e100',' 100.25 ','hola','1.2x',0,' 25.1 ']);
 let seed=47;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};for(let run=0;run<60;run++){const budget=(random()%9999999+1)/100,a=(random()%999999+1)/100,b=(random()%999999+1)/100;await compare('family-budget-7',[budget,2,'Gasto A',String(random()%3+1),a,'Gasto B',String(random()%3+1),b]);}
});
test('sesiones WASM aisladas, reinicio, secuencia idempotente y límites sin cambiar archivos de proyecto',async()=>{
 const client=createLocalPreviewClient({load}),project={files:{'main.py':'# avance del alumno'},entry:'main.py'},before=structuredClone(project);const a=await client.request('start',{program:'family-budget-2'}),b=await client.request('start',{program:'family-budget-2'});const input={token:a.token,sequence:1,value:'Ana'};const reply=await client.request('input',input);assert.deepEqual(await client.request('input',input),reply);await assert.rejects(client.request('input',{...input,value:'Otro'}),/cambió/);const other=await client.request('input',{token:b.token,sequence:1,value:'Luis'});assert.equal(other.sequence,1);assert.equal(reply.sequence,1);assert.deepEqual(project,before);await assert.rejects(client.request('input',{token:a.token,sequence:2,value:'x'.repeat(1001)}),/inválida/);client.clear();await assert.rejects(client.request('input',{token:a.token,sequence:2,value:'Pan'}),/nueva/);
});
function memoryCaches(){const pools=new Map();return{open:async name=>{if(!pools.has(name))pools.set(name,new Map());const data=pools.get(name);return{match:async key=>data.get(key)?.clone(),put:async(key,value)=>data.set(key,value.clone()),delete:async key=>data.delete(key)};},pools};}
test('preparación verifica integridad y arranca una instancia nueva desde caché con toda la red bloqueada',async()=>{
 const cacheStorage=memoryCaches();let requests=0;const first=createPreviewRuntimeLoader({cacheStorage,fetcher:async url=>{requests++;assert.equal(url,previewRuntime.path);return new Response(bytes);}});await Promise.all([first(),first()]);assert.equal(requests,1);
 const offline=createPreviewRuntimeLoader({cacheStorage,fetcher:async()=>{throw new Error('No debe acceder a Internet');}});const client=createLocalPreviewClient({load:offline});let response=await client.request('start',{program:'family-budget-3'});response=await client.request('input',{token:response.token,sequence:1,value:'100'});response=await client.request('input',{token:response.token,sequence:2,value:'25'});assert.match(response.output,/Saldo: \$75.00/);
 const bad=memoryCaches(),corrupted=createPreviewRuntimeLoader({cacheStorage:bad,fetcher:async()=>new Response('binario corrupto')});await assert.rejects(corrupted(),/integridad/);assert.equal([...bad.pools.values()][0].size,0);const pool=await bad.open('aula-preview-wasm-'+previewRuntime.sha256);await pool.put(previewRuntime.path,new Response('cache dañada'));const repaired=createPreviewRuntimeLoader({cacheStorage:bad,fetcher:async()=>new Response(bytes)});await repaired();assert.equal((await(await pool.match(previewRuntime.path)).arrayBuffer()).byteLength,bytes.length);
});
