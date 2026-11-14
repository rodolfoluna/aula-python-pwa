import{mkdir,writeFile}from'node:fs/promises';
import{isDeepStrictEqual as same}from'node:util';
import{createSupabaseStore}from'../accounts/supabase-store.mjs';
import{normalizeActivity}from'../dist/activity-model.js';
import{enableOfflineTopic3}from'./topic3-activity.mjs';
const store=createSupabaseStore(),id='77f893d7-7520-4663-8762-be17c0a770b1',original=await store.activity(id),updated=normalizeActivity(enableOfflineTopic3(original));
if(!same(original.content,updated.content))throw new Error('Esta actualización solo puede cambiar las instrucciones generales.');
if(original.instructions===updated.instructions)console.log('La vista previa offline ya está documentada.');
else{await mkdir('.deployment',{recursive:true});await writeFile(`.deployment/topic3-before-wasm-v${original.version}-${Date.now()}.json`,JSON.stringify(original,null,2),{flag:'wx'});const saved=await store.updateActivity(id,original.version,updated);if(!saved)throw new Error('La plantilla cambió; no se sobrescribió.');console.log(JSON.stringify({title:saved.title,version:saved.version,scope:'Solo instrucciones; archivos, ejercicios, pruebas y trabajos intactos.'}));}
