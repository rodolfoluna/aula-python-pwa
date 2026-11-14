// Server-only reference behavior. Never serve this module or send it to the runner.
export const previewPrograms = Array.from({length:8},(_,index)=>`family-budget-${index+1}`);
export function money(value) {
  // Match Python's formatting of IEEE-754 floats, including ties to even.
  const buffer=new ArrayBuffer(8),view=new DataView(buffer);view.setFloat64(0,Math.abs(value));
  const bits=view.getBigUint64(0),exponent=Number((bits>>52n)&2047n),fraction=bits&((1n<<52n)-1n);
  let numerator=(exponent?fraction+(1n<<52n):fraction)*100n,denominator=1n,power=(exponent?exponent-1023: -1022)-52;
  if(power>=0)numerator<<=BigInt(power);else denominator<<=BigInt(-power);
  let rounded=numerator/denominator;const remainder=numerator%denominator;
  if(remainder*2n>denominator||remainder*2n===denominator&&rounded%2n)rounded++;
  return '$'+(value<0||Object.is(value,-0)?'-':'')+String(rounded/100n)+'.'+String(rounded%100n).padStart(2,'0');
}
const categories=['Alimentación','Transporte','Otros'];
const guide='CONTROL DE GASTOS FAMILIARES\n1. Alimentación\n2. Transporte\n3. Otros\nAnota cada gasto una sola vez\nUsa pesos y punto decimal\nConsulta tu saldo antes de planear otra compra';
const menu='CONTROL DE GASTOS FAMILIARES\n1. Mostrar guía de categorías\n2. Simular una compra con el saldo actual\n3. Registrar un gasto\n4. Consultar historial\n5. Mostrar reporte del presupuesto\n0. Salir';
export function createPreviewProgram(name) {
 if(!previewPrograms.includes(name))throw new Error('Vista previa interactiva no disponible.');
 const exercise=Number(name.split('-').at(-1)),lines=[];
 const say=value=>lines.push(String(value));
 function* number(prompt,min,max,warning,retry=true,integer=false){
  while(true){const text=(yield prompt).trim();const valid=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)&&(!integer||/^[+-]?\d+$/.test(text));const value=valid?Number(text):NaN;
   if(Number.isFinite(value)&&value>=min&&value<=max)return value;
   say(warning);if(!retry)return null;
  }
 }
 function* budget(retry=true){return yield* number('Presupuesto de la familia (más de 0 y hasta 100000):',Number.MIN_VALUE,100000,'Presupuesto fuera de rango',retry);}
 function* amount(retry=true){return yield* number('Importe del gasto (más de 0 y hasta 10000):',Number.MIN_VALUE,10000,'Importe fuera de rango',retry);}
 function classify(balance,projected=false){if(balance>0)say('Queda presupuesto disponible');else if(balance===0)say('Presupuesto agotado');else{say('Presupuesto excedido');say(`${projected?'Exceso proyectado':'Exceso'}: ${money(-balance)}`);}}
 function* expense(){let concept=yield 'Concepto del gasto:';while(!concept.trim()){say('Introduce un concepto no vacío');concept=yield 'Concepto del gasto:';}
  let category=yield 'Categoría: 1 Alimentación, 2 Transporte, 3 Otros';while(!['1','2','3'].includes(category)){say('Categoría no válida');category=yield 'Categoría: 1 Alimentación, 2 Transporte, 3 Otros';}
  return {concept,category:categories[Number(category)-1],amount:yield* amount()};
 }
 const detail=(item,index)=>`Gasto ${index+1}: ${item.concept} | ${item.category} | ${money(item.amount)}`;
 const total=items=>items.reduce((result,item)=>result+item.amount,0);
 function history(items){if(!items.length)say('Sin gastos registrados');items.forEach((item,index)=>say(detail(item,index)));}
 function report(budget,items){const spent=total(items);say(`Cantidad: ${items.length}`);say(`Total: ${money(spent)}`);for(const category of categories)say(`${category}: ${money(total(items.filter(item=>item.category===category)))}`);
  say(`Presupuesto: ${money(budget)}`);say(`Saldo: ${money(budget-spent)}`);classify(budget-spent);
  if(items.length){say(`Promedio: ${money(spent/items.length)}`);let largest=0;items.forEach((item,index)=>{if(item.amount>items[largest].amount)largest=index;});const item=items[largest];say(`Mayor gasto: ${largest+1} | ${item.concept} | ${item.category} | ${money(item.amount)}`);}
 }
 function* program(){
  if(exercise===1){say(guide);return;}
  if(exercise===2){const person=yield 'Nombre de quien hizo el gasto:',concept=yield 'Concepto del gasto:',date=yield 'Fecha del gasto:';say(`FICHA DE GASTO\nPersona: ${person}\nConcepto: ${concept}\nFecha: ${date}\nImporte pendiente de registrar`);return;}
  if(exercise===3||exercise===4){const b=yield* budget(exercise===4);if(b===null)return;const a=yield* amount(exercise===4);if(a===null)return;say(`Presupuesto: ${money(b)}\nGasto: ${money(a)}\nSaldo: ${money(b-a)}`);classify(b-a);return;}
  if(exercise===5){const b=yield* budget(),count=yield* number('Cantidad de gastos (1 a 20):',1,20,'Cantidad fuera de rango',true,true);let spent=0;for(let i=0;i<count;i++){say(`Gasto ${i+1}`);spent+=yield* amount();}say(`Cantidad: ${count}\nPresupuesto: ${money(b)}\nTotal: ${money(spent)}\nSaldo: ${money(b-spent)}`);classify(b-spent);return;}
  if(exercise===6||exercise===7){const b=exercise===7?yield* budget():null,count=yield* number('Cantidad de gastos (0 a 20):',0,20,'Cantidad fuera de rango',true,true),items=[];for(let i=0;i<count;i++)items.push(yield* expense());history(items);if(exercise===7)report(b,items);return;}
  const b=yield* budget(),items=[];
  while(true){say(menu);const option=yield 'Elige una opción:';
   if(option==='0'){say('Hasta pronto');return;}
   if(option==='1')say(guide);
   else if(option==='2'){const balance=b-total(items),proposed=yield* amount();say(`Saldo actual: ${money(balance)}\nPropuesta: ${money(proposed)}\nSaldo proyectado: ${money(balance-proposed)}`);classify(balance-proposed,true);}
   else if(option==='3'){if(items.length>=20)say('Capacidad de registros alcanzada');else{items.push(yield* expense());say('Gasto registrado');say(detail(items.at(-1),items.length-1));const balance=b-total(items);say(`Saldo: ${money(balance)}`);if(balance<=0)classify(balance);}}
   else if(option==='4')history(items);
   else if(option==='5')report(b,items);
   else say('Opción no válida');
  }
 }
 const generator=program();let completed=false;
 return {advance(value){if(completed)throw new Error('La demostración ya terminó.');lines.length=0;const result=generator.next(value);completed=result.done;return {output:lines.length?lines.join('\n')+'\n':'',prompt:result.done?null:result.value,done:result.done};}};
}
