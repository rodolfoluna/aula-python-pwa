import{mkdir,writeFile}from'node:fs/promises';
import{isDeepStrictEqual as same}from'node:util';
import{createSupabaseStore}from'../accounts/supabase-store.mjs';
import{normalizeActivity}from'../dist/activity-model.js';
import{enableInteractiveTopic3}from'./topic3-activity.mjs';
const store=createSupabaseStore(),id='77f893d7-7520-4663-8762-be17c0a770b1',original=await store.activity(id);
const updated=normalizeActivity(enableInteractiveTopic3(original));
if(!same(updated.content.project,original.content.project)||!same(updated.content.exercises.map(e=>[e.id,e.title,e.prompt,e.evaluation.cases]),original.content.exercises.map(e=>[e.id,e.title,e.prompt,e.evaluation.cases])))throw new Error('No se permite cambiar archivos, ejercicios ni pruebas existentes.');
if(same(updated.instructions,original.instructions)&&same(updated.content,original.content)){console.log('La vista previa interactiva ya está habilitada.');}
else{await mkdir('.deployment',{recursive:true});await writeFile(`.deployment/topic3-interactive-backup-v${original.version}-${Date.now()}.json`,JSON.stringify(original,null,2),{flag:'wx'});const saved=await store.updateActivity(id,original.version,updated);if(!saved)throw new Error('La plantilla cambió; no se sobrescribió.');console.log(JSON.stringify({title:saved.title,version:saved.version,interactiveExercises:saved.content.exercises.length,scope:'Solo plantilla; avances y asignaciones intactos.'}));}
