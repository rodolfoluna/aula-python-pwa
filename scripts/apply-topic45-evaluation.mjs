import{readFile,writeFile,mkdir}from'node:fs/promises';
import{isDeepStrictEqual as same}from'node:util';
import{createSupabaseStore}from'../accounts/supabase-store.mjs';
import{normalizeActivity}from'../dist/activity-model.js';
import{upgradeTopic45}from'./topic45-evaluation.mjs';
import{createLocalPreviewClient}from'../accounts-public/preview-wasm.js';
import{previewRuntime}from'../accounts-public/preview-runtime.js';
const store=createSupabaseStore(),module=await WebAssembly.compile(await readFile(new URL('../accounts-public'+previewRuntime.path,import.meta.url))),client=createLocalPreviewClient({load:async()=>module});
const simulate=async(program,inputs)=>{let result=await client.request('start',{program}),output=result.output;for(const value of inputs){if(result.done)throw Error('La demostración terminó antes de las entradas previstas.');result=await client.request('input',{token:result.token,sequence:result.sequence+1,value:String(value)});output+=result.output;}if(!result.done)throw Error('La demostración sigue esperando una entrada.');return output;};
await mkdir(new URL('../.deployment/',import.meta.url),{recursive:true});
for(const[id,title]of [['5a8db713-e8bc-4dcb-9e85-932162e59af4','Ejercicios del tema 4_5'],['bd85b8bb-b824-4b2d-a35c-fb6d03d7e4ac','Problemario del tema 4_5']]){
 const original=await store.activity(id);if(original?.title!==title)throw Error('No coincide la plantilla: '+title);
 if(original.content.exercises.some(e=>e.evaluation))throw Error('La plantilla ya tiene pruebas; revisar antes de reaplicar: '+title);
 const updated=await upgradeTopic45(original,simulate);
 if(!same(original.content.project,updated.content.project)||!same(original.content.exercises.map(e=>[e.id,e.title,e.file]),updated.content.exercises.map(e=>[e.id,e.title,e.file])))throw Error('No se permite cambiar archivos ni asociaciones.');
 const backup=new URL(`../.deployment/topic45-before-evaluation-${id}-v${original.version}-${Date.now()}.json`,import.meta.url);await writeFile(backup,JSON.stringify(original,null,2),{flag:'wx'});
 const saved=await store.updateActivity(id,original.version,normalizeActivity(updated));if(!saved)throw Error('La plantilla cambió; no se sobrescribió: '+title);
 console.log(JSON.stringify({id:saved.id,title:saved.title,version:saved.version,exercises:12,cases:saved.content.exercises.reduce((n,e)=>n+e.evaluation.cases.length,0),scope:'Solo plantilla; archivos y asociaciones intactos. No se crean asignaciones.'}));
}
