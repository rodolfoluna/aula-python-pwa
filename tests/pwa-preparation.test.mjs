import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {setupPwa} from '../accounts-public/pwa.js';

for (const succeeds of [false, true]) test(`preparación offline solo se confirma después de descargar Python: ${succeeds}`, async () => {
  const dom=new JSDOM('<button id="prepare-offline"></button><button id="sync-offline"></button><button id="install-app"></button><p id="pwa-status"></p>',{url:'https://aula.test'});
  const previousNavigator=globalThis.navigator, previousIndexedDB=globalThis.indexedDB; globalThis.indexedDB=new IDBFactory();
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,localStorage:dom.window.localStorage,confirm:()=>true});
  Object.defineProperty(dom.window.navigator,'serviceWorker',{value:{register:async()=>({}),ready:Promise.resolve({})},configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  let committed=0, completed=false, pending, fakeTimer;
  const profile={id:'student',role:'student',must_change_password:false};
  const workspace={enabled:()=>false,prepare:async()=>{assert.equal(completed,true);committed++;}};
  const append=document.body.append.bind(document.body);
  document.body.append=(...nodes)=>{
    append(...nodes);
    const frame=nodes.find(node=>node.tagName==='IFRAME'); if(!frame)return;
    assert.equal(committed,0,'No se deben anunciar actividades preparadas mientras falta Python');
    queueMicrotask(()=>{completed=true;window.dispatchEvent(new dom.window.MessageEvent('message',{source:frame.contentWindow,origin:'https://runner.test',data:{type:'aula-offline-progress',...(succeeds?{ready:true,total:18}:{error:'Descarga interrumpida'})}}));});
  };
  const originalInterval=globalThis.setInterval;
  globalThis.setInterval=(...args)=>{fakeTimer=originalInterval(...args);return fakeTimer;};
  try {
    setupPwa({workspace,getProfile:()=>profile,getRunnerOrigin:()=> 'https://runner.test',perform:action=>{pending=action();},api:async path=>path==='activities'?{assignments:[]}:path==='my-groups'?{groups:[]}:{configured:true}});
    document.querySelector('#prepare-offline').click();
    if(succeeds){await pending;assert.equal(committed,1);assert.match(document.querySelector('#pwa-status').textContent,/Listo:/);}
    else{await assert.rejects(pending,/Descarga interrumpida/);assert.equal(committed,0);assert.match(document.querySelector('#pwa-status').textContent,/Preparación incompleta/);}
  } finally {clearInterval(fakeTimer);globalThis.setInterval=originalInterval;globalThis.indexedDB=previousIndexedDB;dom.window.close();Object.defineProperty(globalThis,'navigator',{value:previousNavigator,configurable:true});}
});
