import {previewRuntime} from './preview-runtime.js';

// This loader knows the console ABI only. All reference behavior is in WebAssembly.
export function createPreviewRuntimeLoader({fetcher=(...args)=>fetch(...args),cacheStorage=globalThis.caches}={}) {
 let pending;
 return function load(){
  if(pending)return pending;
  pending=(async()=>{
   if(typeof WebAssembly==='undefined'||!globalThis.crypto?.subtle)throw new Error('Este navegador no permite ejecutar la vista previa WebAssembly.');
   const cache=cacheStorage&&await cacheStorage.open('aula-preview-wasm-'+previewRuntime.sha256);
   let response=cache&&await cache.match(previewRuntime.path),fromCache=!!response;
   async function verify(value){if(!value?.ok)throw new Error('No se pudo descargar la vista previa. Prepara la app con conexión.');const bytes=await value.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');if(bytes.byteLength!==previewRuntime.bytes||hash!==previewRuntime.sha256)throw new Error('La vista previa no pasó la comprobación de integridad. Actualiza la app y vuelve a preparar sin conexión.');return bytes;}
   async function download(){try{return await fetcher(previewRuntime.path,{cache:'no-cache',credentials:'omit'});}catch{throw new Error('La vista previa aún no está preparada en este equipo. Conéctate y pulsa «Preparar sin conexión».');}}
   let bytes;
   try{bytes=await verify(response||await download());}
   catch(error){if(!fromCache)throw error;await cache.delete(previewRuntime.path);fromCache=false;bytes=await verify(await download());}
   const module=await WebAssembly.compile(bytes);
   if(cache&&!fromCache)await cache.put(previewRuntime.path,new Response(bytes,{headers:{'Content-Type':'application/wasm'}}));
   return module;
  })().catch(error=>{pending=null;throw error;});
  return pending;
 };
}
export const ensurePreviewRuntime=createPreviewRuntimeLoader();
export function createLocalPreviewClient({load=ensurePreviewRuntime}={}) {
 const sessions=new Map(),decoder=new TextDecoder(),encoder=new TextEncoder();let generation=0;
 const read=wasm=>JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer,wasm.resultPointer(),wasm.resultLength())));
 return {
  clear(){generation++;sessions.clear();},
  async request(action,data){
   if(action==='start'){
    if(typeof data.program!=='string'||!/^family-budget-[1-8]$/.test(data.program))throw new Error('Este ejercicio no tiene una simulación WebAssembly configurada.');
    const current=generation,module=await load();if(current!==generation)throw new Error('La actividad cambió. Inicia otra demostración.');
    const instance=await WebAssembly.instantiate(module,{env:{abort(){throw new Error('La demostración alcanzó su límite de memoria. Puedes reiniciarla.');}}});
    if(current!==generation)throw new Error('La actividad cambió. Inicia otra demostración.');
    const wasm=instance.exports;wasm.init(Number(data.program.at(-1)));
    const token=crypto.randomUUID(),result={token,sequence:0,...read(wasm)};
    if(sessions.size>=8)sessions.delete(sessions.keys().next().value);
    sessions.set(token,{wasm,sequence:0,result,steps:0,bytes:result.output.length});return result;
   }
   if(action!=='input')throw new Error('Acción de demostración inválida.');
   const state=sessions.get(data.token);if(!state)throw new Error('Inicia una nueva demostración para continuar.');
   if(typeof data.value!=='string'||data.value.length>1000||/[\r\n]/.test(data.value)||!Number.isInteger(data.sequence))throw new Error('Entrada de demostración inválida.');
   if(data.sequence===state.sequence&&data.value===state.lastInput)return state.result;
   if(data.sequence!==state.sequence+1||state.result.done)throw new Error('La demostración cambió. Reiníciala antes de continuar.');
   if(state.steps>=500||state.bytes>100000){sessions.delete(data.token);throw new Error('Se alcanzó el límite de la demostración. Puedes reiniciarla.');}
   const bytes=encoder.encode(data.value),pointer=state.wasm.allocInput(bytes.length);new Uint8Array(state.wasm.memory.buffer,pointer,bytes.length).set(bytes);state.wasm.submit(bytes.length);
   const result={token:data.token,sequence:data.sequence,...read(state.wasm)};state.steps++;state.bytes+=result.output.length;state.sequence=data.sequence;state.lastInput=data.value;state.result=result;return result;
  }
 };
}
