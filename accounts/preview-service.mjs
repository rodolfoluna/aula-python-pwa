import {randomUUID} from 'node:crypto';
import {AccountError} from './service.mjs';
import {createPreviewProgram} from './preview-programs.mjs';
export function createPreviewService(store,clock=()=>Date.now()) {
 const sessions=new WeakMap(),starts=new WeakMap(),ttl=15*60*1000;
 const remove=(pool,key)=>{clearTimeout(pool.get(key)?.timer);pool.delete(key);};
 const denied=()=>new AccountError(404,'Vista previa no encontrada o sin acceso.');
 return {
  async start(profile,session,data){
   let rate=starts.get(session);if(!rate||rate.until<=clock()){rate={until:clock()+60000,count:0};starts.set(session,rate);}if(rate.count++>=30)throw new AccountError(429,'Espera un minuto antes de iniciar más demostraciones.');
   let activity;
   if(data.assignmentId){const assignment=await store.assignment(data.assignmentId);if(!assignment)throw denied();if(profile.role==='teacher'?assignment.teacher_id!==profile.id:!await store.membership(assignment.group_id,profile.id))throw denied();activity=assignment.snapshot;}
   else {if(profile.role!=='teacher'||!data.activityId)throw denied();activity=await store.activity(data.activityId);if(activity?.teacher_id!==profile.id)throw denied();}
   const evaluation=activity?.content?.exercises?.find(item=>item.id===data.exerciseId)?.evaluation;
   if(!evaluation?.preview||!evaluation.previewProgram)throw new AccountError(400,'Este ejercicio no tiene una simulación interactiva guardada.');
   let pool=sessions.get(session);if(!pool){pool=new Map();sessions.set(session,pool);}for(const [key,value]of pool)if(value.expires<=clock())remove(pool,key);
   if(pool.size>=4)remove(pool,pool.keys().next().value);
   const token=randomUUID(),program=createPreviewProgram(evaluation.previewProgram),result={token,sequence:0,...program.advance()},timer=setTimeout(()=>pool.delete(token),ttl);timer.unref?.();pool.set(token,{program,sequence:0,result,expires:clock()+ttl,bytes:result.output.length,timer});return result;
  },
  input(session,data){
   const pool=sessions.get(session),state=pool?.get(data.token);if(!state||state.expires<=clock()){if(pool)remove(pool,data.token);throw new AccountError(410,'La simulación caducó. Inicia una nueva demostración.');}
   if(typeof data.value!=='string'||data.value.length>1000||/[\r\n]/.test(data.value)||!Number.isInteger(data.sequence))throw new AccountError(400,'Entrada de demostración inválida.');
   if(data.sequence===state.sequence&&data.value===state.lastInput)return state.result;
   if(data.sequence!==state.sequence+1||state.result.done)throw new AccountError(409,'La demostración cambió. Reiníciala antes de continuar.');
   if(state.sequence>=500||state.bytes>100000){remove(pool,data.token);throw new AccountError(429,'Se alcanzó el límite de la demostración. Puedes reiniciarla.');}
   const result={token:data.token,sequence:data.sequence,...state.program.advance(data.value)};state.sequence=data.sequence;state.lastInput=data.value;state.result=result;state.bytes+=result.output.length;return result;
  }
 };
}
