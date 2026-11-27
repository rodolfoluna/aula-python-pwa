import {money,number,quote} from './family-budget';
const laundryGuide='LAVANDERÍA LA ESPUMA\n1. Ropa: $18.00 por kg\n2. Cobijas: $30.00 por kg\nPeso por pedido: de 0.25 a 20.00 kg\nServicio normal: sin recargo\nServicio exprés: 20% del subtotal\nCliente frecuente: 10% de descuento sobre el subtotal\nCada pedido contiene un solo tipo de servicio';
const loanGuide='BANCO DE HERRAMIENTAS MANOS AL BARRIO\nM. Martillo: 4 unidades iniciales\nD. Destornillador: 3 unidades iniciales\nP. Pinza: 2 unidades iniciales\nCada préstamo contiene un solo tipo de herramienta\nModalidad estándar: hasta 2 unidades por préstamo\nJornada comunitaria: hasta 3 unidades por préstamo\nCada préstamo se devuelve completo una sola vez';
const laundryMenu='LAVANDERÍA LA ESPUMA\n1. Consultar servicios y reglas\n2. Cotizar sin registrar\n3. Registrar pedido\n4. Consultar historial\n5. Mostrar reporte\n0. Salir';
const loanMenu='BANCO DE HERRAMIENTAS MANOS AL BARRIO\n1. Consultar reglas\n2. Ver catálogo disponible\n3. Simular una solicitud sin registrar\n4. Registrar préstamo\n5. Devolver un préstamo completo\n6. Ver historial\n7. Mostrar reporte\n0. Salir';
let domain:i32=0,exercise:i32=0,stage:i32=0,mode:i32=0,count:i32=0,index:i32=0,service:i32=0,quantity:i32=0,limit:i32=2,viable:i32=0,rejected:i32=0,units:i32=0;
let weight:f64=0,subtotal:f64=0,accumulated:f64=0,express:bool=false,frequent:bool=false;
let name='',code='',description='',prompt='',output='';let done:bool=false;
let names:string[]=[],codes:string[]=[],weights:f64[]=[],urgents:bool[]=[],frequents:bool[]=[],totals:f64[]=[];
let stock:i32[]=[4,3,2],loanNames:string[]=[],loanCodes:string[]=[],quantities:i32[]=[],active:bool[]=[];
const toolCodes:string[]=['M','D','P'],tools:string[]=['Martillo','Destornillador','Pinza'];
let inputBytes=new ArrayBuffer(0),response=new ArrayBuffer(0);
function fixed(value:f64):string{return money(value).substring(1);}
function say(value:string):void{output+=value+'\n';}
function ask(value:string,next:i32):void{prompt=value;stage=next;}
function finish():void{done=true;prompt='';stage=0;}
function encode():void{response=String.UTF8.encode('{"output":'+quote(output)+',"prompt":'+(done?'null':quote(prompt))+',"done":'+(done?'true':'false')+'}');}
function toolIndex(value:string):i32{for(let i=0;i<3;i++)if(toolCodes[i]==value)return i;return -1;}
function serviceName(value:string):string{return value=='1'?'Ropa':'Cobijas';}
function finalAmount(base:f64,urgent:bool,regular:bool):f64{return base-base*(regular?.10:0)+base*(urgent?.20:0);}
function menu():void{say(domain==1?laundryMenu:loanMenu);ask('Elige una opción:',90);}
function catalog():void{for(let i=0;i<3;i++)say(toolCodes[i]+' | '+tools[i]+' | Disponibles: '+stock[i].toString());}
function laundryLine(i:i32):string{return 'Pedido '+(i+1).toString()+': '+names[i]+' | '+serviceName(codes[i])+' | '+fixed(weights[i])+' kg | '+(urgents[i]?'Exprés':'Normal')+' | Frecuente: '+(frequents[i]?'Sí':'No')+' | '+money(totals[i]);}
function laundryHistory():void{if(!names.length)say('Sin pedidos registrados');for(let i=0;i<names.length;i++)say(laundryLine(i));}
function laundryReport():void{
 let sum:f64=0,kg:f64=0,urgent=0,regular=0,largest=0;
 for(let i=0;i<names.length;i++){sum+=totals[i];kg+=weights[i];if(urgents[i])urgent++;if(frequents[i])regular++;if(totals[i]>totals[largest])largest=i;}
 if(!names.length)say('Sin pedidos registrados');say('Cantidad: '+names.length.toString());say('Peso total: '+fixed(kg)+' kg');say('Total: '+money(sum));say('Exprés: '+urgent.toString());say('Frecuentes: '+regular.toString());
 for(let c=1;c<=2;c++){let n=0;let amount:f64=0;for(let i=0;i<names.length;i++)if(codes[i]==c.toString()){n++;amount+=totals[i];}say(serviceName(c.toString())+': '+n.toString()+' pedidos | '+money(amount));}
 if(names.length){say('Promedio: '+money(sum/names.length));say('Mayor pedido: '+(largest+1).toString()+' | '+names[largest]+' | '+money(totals[largest]));}
}
function loanLine(i:i32):string{return 'Préstamo '+(i+1).toString()+': '+loanNames[i]+' | '+loanCodes[i]+' | '+quantities[i].toString()+' | '+(active[i]?'Pendiente':'Devuelto');}
function loanHistory(pending:bool=false):void{if(!loanNames.length){say('Sin préstamos registrados');return;}let found=false;for(let i=0;i<loanNames.length;i++)if(!pending||active[i]){say(loanLine(i));found=true;}if(!found)say('Sin préstamos pendientes');}
function loanReport():void{let pending=0,units=0;for(let i=0;i<active.length;i++)if(active[i]){pending++;units+=quantities[i];}say('Préstamos: '+active.length.toString());say('Pendientes: '+pending.toString());say('Devueltos: '+(active.length-pending).toString());say('Unidades pendientes: '+units.toString());for(let c=0;c<3;c++){let q=0;for(let i=0;i<active.length;i++)if(active[i]&&loanCodes[i]==toolCodes[c])q+=quantities[i];say(toolCodes[c]+' | '+tools[c]+' | Disponibles: '+stock[c].toString()+' | Pendientes: '+q.toString()+' | Total controlado: '+(stock[c]+q).toString());}}
function laundryQuote():void{if(name.length)say('Cliente: '+name);say('Servicio: '+serviceName(code));say('Peso: '+fixed(weight)+' kg');say('Tarifa: '+money(code=='1'?18:30)+' por kg');say('Modalidad: '+(express?'Exprés':'Normal'));say('Frecuente: '+(frequent?'Sí':'No'));say('Subtotal: '+money(subtotal));say('Descuento: '+money(subtotal*(frequent?.10:0)));say('Recargo: '+money(subtotal*(express?.20:0)));say('Total: '+money(finalAmount(subtotal,express,frequent)));}
function askLaundry():void{name='';if(exercise>=5&&exercise!=7)ask('Cliente:',10);else ask('Servicio: 1 Ropa, 2 Cobijas',11);}
function completeLaundry():void{
 subtotal=weight*(code=='1'?18:30);
 if(exercise==7){say('Subtotal: '+money(subtotal));finish();return;}
 if(exercise<=4){laundryQuote();accumulated+=finalAmount(subtotal,express,false);index++;if(exercise==4&&index<count){say('Cotización '+(index+1).toString());askLaundry();}else{if(exercise==4){say('Cantidad: '+count.toString());say('Total cotizado: '+money(accumulated));}finish();}return;}
 if(exercise==9){laundryQuote();ask('Entero de prueba (0 a 30):',16);return;}
 if(exercise>=10&&mode==2){laundryQuote();menu();return;}
 names.push(name);codes.push(code);weights.push(weight);urgents.push(express);frequents.push(frequent);totals.push(finalAmount(subtotal,express,frequent));
 if(exercise==5){index++;if(index<count)askLaundry();else{laundryHistory();let sum:f64=0;for(let i=0;i<totals.length;i++)sum+=totals[i];say('Cantidad: '+names.length.toString());say('Total: '+money(sum));finish();}}
 else{say('Pedido registrado');say(laundryLine(names.length-1));laundryQuote();menu();}
}
function askLoan():void{name='';if(exercise==5||exercise==9||mode==4)ask('Persona:',50);else ask('Código: M, D, P',51);}
function completeLoan():void{
 const enough=quantity<=stock[service];
 if(exercise<=4||exercise==9||mode==3){if(enough){say('Solicitud viable');say('Herramienta: '+tools[service]);say('Cantidad: '+quantity.toString());say('Límite: '+limit.toString());say('Disponibles actuales: '+stock[service].toString());say('Disponibles posteriores: '+(stock[service]-quantity).toString());viable++;units+=quantity;}else{say('Unidades insuficientes');rejected++;}}
 else if(!enough)say('Unidades insuficientes');
 else{stock[service]-=quantity;loanNames.push(name);loanCodes.push(code);quantities.push(quantity);active.push(true);say('Préstamo registrado');say(loanLine(loanNames.length-1));say('Herramienta: '+tools[service]);say('Disponibles: '+stock[service].toString());}
 if(exercise==4||exercise==5){index++;if(index<count){say((exercise==4?'Consulta ':'Solicitud ')+(index+1).toString());askLoan();return;}if(exercise==4){say('Viables: '+viable.toString());say('Rechazadas por disponibilidad: '+rejected.toString());say('Unidades viables: '+units.toString());}else{loanHistory();catalog();}finish();}
 else if(exercise>=10)menu();else finish();
}
export function init(program:i32):void{
 domain=program>=200?2:1;exercise=program%100;assert(exercise>=1&&exercise<=12);stage=0;mode=0;count=0;index=0;service=0;quantity=0;limit=2;viable=0;rejected=0;units=0;weight=0;subtotal=0;accumulated=0;express=false;frequent=false;name='';code='';description='';prompt='';output='';done=false;
 names=[];codes=[];weights=[];urgents=[];frequents=[];totals=[];stock=[4,3,2];loanNames=[];loanCodes=[];quantities=[];active=[];
 if(exercise==1){say(domain==1?laundryGuide:loanGuide);finish();}
 else if(exercise==2)ask(domain==1?'Cliente:':'Persona:',1);
 else if(exercise==6){const guide=domain==1?laundryGuide:loanGuide;say(guide);say(domain==1?'SEGUNDA CONSULTA':'NUEVA CONSULTA DE REGLAS');say(guide);finish();}
 else if(exercise>=10)menu();
 else if(domain==1){if(exercise==4||exercise==5)ask(exercise==4?'Cantidad de cotizaciones (1 a 10):':'Cantidad de pedidos (0 a 30):',9);else if(exercise==8)ask('Subtotal:',20);else askLaundry();}
 else{if(exercise==4||exercise==5)ask(exercise==4?'Cantidad de consultas (1 a 10):':'Cantidad de solicitudes (0 a 10):',49);else if(exercise==7)ask('Código a buscar (M, D, P):',60);else if(exercise==8)ask('Disponibles (entero no negativo):',61);else askLoan();}
 encode();
}
export function allocInput(length:i32):usize{assert(length>=0&&length<=4000);inputBytes=new ArrayBuffer(length);return changetype<usize>(inputBytes);}
export function submit(length:i32):void{
 assert(!done&&length>=0&&length<=inputBytes.byteLength);const original=String.UTF8.decodeUnsafe(changetype<usize>(inputBytes),length),value=original.trim();output='';
 if(stage==1){name=original;ask(domain==1?'Descripción:':'Herramienta solicitada:',2);}
 else if(stage==2){description=original;ask(domain==1?'Fecha:':'Trabajo:',3);}
 else if(stage==3){say(domain==1?'SOLICITUD DE LAVADO':'SOLICITUD DE HERRAMIENTA');say((domain==1?'Cliente: ':'Persona: ')+name);say((domain==1?'Descripción: ':'Herramienta solicitada: ')+description);say((domain==1?'Fecha: ':'Trabajo: ')+original);say(domain==1?'Pendiente de pesaje y cotización':'Solicitud pendiente de verificar disponibilidad');finish();}
 else if(stage==9){const n=number(value,true);if(!(n>=(exercise==4?1:0)&&n<=(exercise==4?10:30)))say('Cantidad fuera de rango');else{count=i32(n);if(!count){say('Sin pedidos registrados');say('Cantidad: 0');say('Total: $0.00');finish();}else{if(exercise==4)say('Cotización 1');askLaundry();}}}
 else if(stage==10){if(!value.length)say(exercise>=9?'Texto no válido':'Nombre no válido');else{name=value;ask('Servicio: 1 Ropa, 2 Cobijas',11);}}
 else if(stage==11){if(value!='1'&&value!='2'){say(exercise>=9?'Opción no válida':'Servicio no válido');if(exercise==3)finish();}else{code=value;ask('Peso (0.25 a 20.00 kg):',12);}}
 else if(stage==12){const n=number(value);if(!(n>=.25&&n<=20)){say(exercise>=9?'Valor fuera de rango':'Peso fuera de rango');if(exercise==3)finish();}else{weight=n;if(exercise==7)completeLaundry();else ask('Modalidad: 0 Normal, 1 Exprés',13);}}
 else if(stage==13){if(value!='0'&&value!='1'){say(exercise>=9?'Opción no válida':'Modalidad no válida');if(exercise==3)finish();}else{express=value=='1';if(exercise>=5)ask('Cliente frecuente: 0 No, 1 Sí',14);else completeLaundry();}}
 else if(stage==14){if(value!='0'&&value!='1')say(exercise>=9?'Opción no válida':'Condición no válida');else{frequent=value=='1';completeLaundry();}}
 else if(stage==16){const n=number(value,true);if(!(n>=0&&n<=30))say('Valor fuera de rango');else{say('Entero de prueba: '+i32(n).toString());finish();}}
 else if(stage==20){const n=number(value);if(!(n>=0&&n<=1000000))say('Valor fuera de rango');else{subtotal=n;ask('Exprés: 0 No, 1 Sí (vacío usa False)',21);}}
 else if(stage==21){if(value!=''&&value!='0'&&value!='1')say('Opción no válida');else{express=value=='1';ask('Descuento de 0.0 a 0.10 (vacío usa 0.0):',22);}}
 else if(stage==22){const n=value.length?number(value):0;if(!(n>=0&&n<=.10))say('Valor fuera de rango');else{say('Total: '+money(subtotal-subtotal*n+subtotal*(express?.20:0)));finish();}}
 else if(stage==49){const n=number(value,true);if(!(n>=(exercise==4?1:0)&&n<=10))say(exercise==4?'Cantidad de consultas fuera de rango':'Cantidad de solicitudes fuera de rango');else{count=i32(n);if(!count){loanHistory();catalog();finish();}else{say(exercise==4?'Consulta 1':'Solicitud 1');askLoan();}}}
 else if(stage==50){if(!value.length)say(exercise>=9?'Texto no válido':'Nombre no válido');else{name=value;ask('Código: M, D, P',51);}}
 else if(stage==51){const c=toolIndex(value);if(c<0){say(exercise>=9?'Opción no válida':'Herramienta no válida');if(exercise==3)finish();}else{code=value;service=c;if(exercise==3){limit=2;ask('Cantidad (1 a 2):',53);}else ask('Modalidad: 1 Estándar, 2 Jornada comunitaria',52);}}
 else if(stage==52){if(value!='1'&&value!='2')say(exercise>=9?'Opción no válida':'Modalidad no válida');else{limit=value=='1'?2:3;ask('Cantidad (1 a '+limit.toString()+'):',53);}}
 else if(stage==53){const n=number(value,true);if(!(n>=1&&n<=limit)){say(exercise>=9?'Valor fuera de rango':'Cantidad fuera de límite');if(exercise==3)finish();}else{quantity=i32(n);completeLoan();}}
 else if(stage==60){say('Índice: '+toolIndex(value).toString());finish();}
 else if(stage==61){const n=number(value,true);if(!(n>=0&&n<=100000))say('Valor fuera de rango');else{service=i32(n);ask('Cantidad solicitada (entero):',62);}}
 else if(stage==62){const n=number(value,true);if(!isFinite(n))say('Valor fuera de rango');else{quantity=i32(n);ask('Límite (entero positivo, vacío usa 2):',63);}}
 else if(stage==63){const n=value.length?number(value,true):2;if(!(n>0&&n<=100000))say('Valor fuera de rango');else{say('Resultado: '+(quantity>=1&&quantity<=i32(n)&&quantity<=service?'True':'False'));finish();}}
 else if(stage==90){
  if(value=='0'){say('Hasta pronto');finish();}
  else if(domain==1){if(value=='1'){say(laundryGuide);menu();}else if(value=='2'||value=='3'){mode=value=='2'?2:3;if(mode==3&&names.length>=30){say('Capacidad de pedidos alcanzada');menu();}else askLaundry();}else if(value=='4'){laundryHistory();menu();}else if(value=='5'){laundryReport();menu();}else say('Opción no válida');}
  else{if(value=='1'){say(loanGuide);menu();}else if(value=='2'){catalog();menu();}else if(value=='3'||value=='4'){mode=value=='3'?3:4;if(mode==4&&loanNames.length>=30){say('Capacidad de préstamos alcanzada');menu();}else askLoan();}else if(value=='5'){if(!loanNames.length){say('Sin préstamos registrados');menu();}else{loanHistory(true);let pending=false;for(let i=0;i<active.length;i++)if(active[i])pending=true;if(pending)ask('Número de préstamo a devolver:',91);else menu();}}else if(value=='6')ask('Filtro: 1 Todos, 2 Pendientes',92);else if(value=='7'){loanReport();menu();}else say('Opción no válida');}
 }else if(stage==91){const n=number(value,true);if(n>=1&&n<=loanNames.length&&active[i32(n)-1]){const i=i32(n)-1;stock[toolIndex(loanCodes[i])]+=quantities[i];active[i]=false;say('Devolución registrada');}else say('Préstamo inexistente o ya devuelto');menu();}
 else if(stage==92){if(value!='1'&&value!='2')say('Opción no válida');else{loanHistory(value=='2');menu();}}
 encode();
}
export function resultPointer():usize{return changetype<usize>(response);}
export function resultLength():i32{return response.byteLength;}
