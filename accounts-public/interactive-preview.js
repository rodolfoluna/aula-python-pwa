// Console UI only. The compiled runtime remains separate from project files.
const topic45Labels=['Informar','Identificar solicitud','Decidir','Repetir con validación','Registrar en listas','Función sin parámetros','Parámetros y retorno','Valores predeterminados','Funciones de captura','Laboratorio de registro','Laboratorio de consultas','Menú completo'];
export const previewChoices = [
 ['','Solo ejemplos de prueba'],
 ...['laundry','tool-loans'].flatMap(domain=>topic45Labels.map((label,index)=>[`${domain}-${index+1}`,`${domain==='laundry'?'Lavandería':'Herramientas'} · ${index+1}. ${label}`])),
 ...['Guía de categorías','Ficha de gasto','Comparar compra y presupuesto','Validar presupuesto e importe','Acumular gastos del día','Consultar historial','Analizar gastos','Menú de control de gastos'].map((label,index)=>[`family-budget-${index+1}`,`Tema 3 · ${index+1}. ${label}`])
];
export function mountInteractivePreview(root,{state,request,exerciseId,program}) {
 const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
 state.logs ||= [];state.generation ||= 0;state.input ||= '';
 const description=el('p','Introduce tus propios datos para explorar el funcionamiento esperado. Disponible sin conexión después de preparar la app. Esta consola de demostración es independiente de tus archivos y de tu entrega.','muted');
 const controls=el('div',undefined,'worksheet-toolbar'),start=el('button','Iniciar demostración'),status=el('p','', 'preview-state'),consoleView=el('pre',undefined,'preview-console'),form=el('form',undefined,'preview-input-form'),label=el('label'),field=el('input'),send=el('button','Enviar dato');
 start.type='button';send.type='submit';field.type='text';field.maxLength=1000;field.autocomplete='off';field.setAttribute('aria-label','Dato para la demostración');consoleView.setAttribute('role','log');consoleView.setAttribute('aria-label','Consola de funcionamiento esperado');status.setAttribute('role','status');
 field.value=state.input;field.oninput=()=>{state.input=field.value;};
 const prompt=el('span');label.append(prompt,field);form.append(label,send);controls.append(start);root.append(description,controls,status,consoleView,form);
 function paint(){start.textContent=state.token?'Reiniciar demostración':'Iniciar demostración';start.disabled=!!state.busy;send.disabled=!!state.busy;field.disabled=!!state.busy;
  if(field.value!==state.input)field.value=state.input;prompt.textContent=state.prompt||'';form.hidden=!state.prompt||state.done===true;consoleView.textContent=state.logs.join('');consoleView.hidden=!state.logs.length;
  status.textContent=state.error|| (state.busy?'Consultando funcionamiento esperado…':state.done?'Demostración finalizada. Puedes reiniciarla con otros datos.':state.prompt?'Esperando tu dato…':'Pulsa Iniciar demostración para probar el programa.');status.className=state.error?'preview-state error':'preview-state';consoleView.scrollTop=consoleView.scrollHeight;
 }
 state.paint=paint;
 async function transact(action){
  if(state.busy)return;
  state.busy=true;state.error='';const generation=state.generation,value=field.value;paint();
  try{
   const data=action==='start'?{exerciseId,program}:{token:state.token,sequence:state.sequence+1,value};
   if(!request)throw new Error('No se pudo conectar con la vista previa.');
   const result=await request(action,data);if(state.generation!==generation)return;
   if(action==='start'){state.logs=[];state.open=true;}else state.logs.push('> '+value+'\n');
   if(action==='start'||result.sequence>state.sequence){if(result.output)state.logs.push(result.output);if(result.prompt)state.logs.push(result.prompt+'\n');}
   Object.assign(state,{token:result.token,sequence:result.sequence,prompt:result.prompt,done:result.done,input:''});field.value='';
   while(state.logs.join('').length>100000&&state.logs.length>1)state.logs.shift();
  }catch(error){if(state.generation===generation)state.error=error.message||'No se pudo consultar la demostración. Inténtalo de nuevo.';}
  finally{if(state.generation===generation){state.busy=false;state.paint?.();if(state.prompt&&field.isConnected)field.focus();}}
 }
 start.onclick=()=>transact('start');form.onsubmit=event=>{event.preventDefault();if(state.prompt&&!state.done)void transact('input');};paint();
 return {destroy(){if(state.paint===paint)state.paint=null;}};
}
