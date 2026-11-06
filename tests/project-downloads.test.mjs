import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {projectZip,windowsExecutable,windowsTemplate,supportsWindowsExe} from '../accounts-public/project-downloads.js';
import {windowsRuntime} from '../accounts-public/windows-runtime.js';

test('exportación Windows valida integridad y reutiliza solo la plantilla pública desde caché sin red',async()=>{
 const source=await readFile(new URL('../accounts-public'+windowsRuntime.path,import.meta.url)),cache=new Map();let requests=0;
 const caches={keys:async()=>['aula-windows-exe-old','aula-shell-current'],delete:async key=>{assert.equal(key,'aula-windows-exe-old');return true;},open:async()=>({match:async key=>cache.get(key)?.clone(),put:async(key,response)=>cache.set(key,response),delete:async key=>cache.delete(key)})};
 const first=await windowsTemplate({cacheStorage:caches,fetchImpl:async()=>{requests++;return new Response(source);}});assert.equal(first.byteLength,windowsRuntime.bytes);assert.equal(requests,1);
 const second=await windowsTemplate({cacheStorage:caches,fetchImpl:async()=>{throw new Error('Sin conexión');}});assert.equal(second.byteLength,first.byteLength);assert.equal(requests,1);
 await assert.rejects(windowsTemplate({fetchImpl:async()=>new Response('incompleto')}),/incompleto/);
 assert.equal(supportsWindowsExe({platform:'Win32'}),true);assert.equal(supportsWindowsExe({platform:'Linux'}),false);
});

test('ZIP seleccionado y exe real de Windows incluyen Unicode, módulos del proyecto y arrancan el archivo elegido',{skip:process.platform!=='win32'},async()=>{
 const files={'main.py':'print("NO EJECUTAR MAIN")','funciones.py':'def doble(n): return n*2','abierto.py':'from funciones import doble\nimport json,statistics,sys\nprint("EXE",doble(21),statistics.mean([2,4]))\nprint(input("Nombre: "))\nprint(json.dumps(sys.argv[1:]))'};
 const name='.deployment/export-test-'+crypto.randomUUID(),exePath=name+'.exe',zipPath=name+'.zip';await mkdir('.deployment',{recursive:true});
 try{
  const zip=projectZip(files,['abierto.py','funciones.py']);await writeFile(zipPath,Buffer.from(await zip.arrayBuffer()));
  const blob=await windowsExecutable(files,'abierto.py',{fetchImpl:async()=>new Response(await readFile(new URL('../accounts-public'+windowsRuntime.path,import.meta.url)))});await writeFile(exePath,Buffer.from(await blob.arrayBuffer()));
  const output=execFileSync(exePath,['a b'],{input:'José 🐍\n',encoding:'utf8',timeout:30000,windowsHide:true});assert.match(output,/EXE 42 3/);assert.match(output,/José 🐍/);assert.doesNotMatch(output,/NO EJECUTAR MAIN/);assert.match(output,/a b/);
  const list=execFileSync('python',['-c','import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print("|".join(z.namelist()));assert z.read("funciones.py").decode()=="def doble(n): return n*2"',zipPath],{encoding:'utf8',windowsHide:true});assert.equal(list.trim(),'abierto.py|funciones.py');
 }finally{await unlink(exePath).catch(()=>{});await unlink(zipPath).catch(()=>{});}
});
