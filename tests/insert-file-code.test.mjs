import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {newActivity,initialAnswer} from '../dist/activity-model.js';
import {createWorksheet} from '../accounts-public/worksheet.js';
import {mountCodeEditor} from '../accounts-public/code-editor.js';
import {EditorView} from '../accounts-public/vendor/code-editor.js';

test('insertar otro archivo respeta cursor, copia completa, origen, cancelación y permisos del alumno',()=>{
  const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document});
  const activity=newActivity('files');activity.content.exercises[0].files={'main.py':'antes\ndespués','funciones.py':'# José 🐍\ndef doble(n):\n    return n * 2\n','bloqueado.py':'EJEMPLO = 42'};activity.content.exercises[0].lockedFiles=['bloqueado.py'];
  const answer=initialAnswer(activity),root=document.querySelector('#root');let changes=0;
  const worksheet=createWorksheet(root,{activity,answer,role:'student',onChange:()=>changes++});
  const button=text=>[...root.querySelectorAll('button')].find(el=>el.textContent===text);
  try{
    const field=root.querySelector('[aria-label="Código de main.py"]');field.setSelectionRange(6,6);
    button('Insertar desde archivo').click();const picker=root.querySelector('[aria-label="Archivo del que copiar"]');
    assert.deepEqual([...picker.options].map(o=>o.value),['funciones.py','bloqueado.py']);
    button('Cancelar copia').click();assert.equal(changes,0);assert.equal(field.value,'antes\ndespués');
    field.setSelectionRange(6,6);button('Insertar desde archivo').click();
    root.querySelector('.worksheet-copy-form').dispatchEvent(new window.Event('submit',{cancelable:true}));
    const source=activity.content.exercises[0].files['funciones.py'];
    assert.equal(field.value,'antes\n'+source+'después');assert.equal(answer.project.files['main.py'],field.value);assert.equal(changes,1);
    assert.equal(answer.project.files['funciones.py'],source);assert.equal(field.selectionEnd,6+source.length);
    button('bloqueado.py 🔒').click();assert.equal(button('Insertar desde archivo').disabled,true);
    button('main.py').click();worksheet.setReadonly(true);assert.equal(button('Insertar desde archivo').disabled,true);
  }finally{worksheet.destroy();dom.window.close();}
});

test('CodeMirror inserta en el cursor guardado sin reemplazar selección y permite deshacer como una sola operación',()=>{
  const dom=new JSDOM('<textarea aria-label="Código Python">antes después</textarea>',{pretendToBeVisual:true});const {window}=dom;
  window.Range.prototype.getClientRects=()=>[];window.Range.prototype.getBoundingClientRect=()=>({left:0,top:0,right:0,bottom:0,width:0,height:0});
  Object.assign(globalThis,{window,document:window.document,MutationObserver:window.MutationObserver,requestAnimationFrame:window.requestAnimationFrame.bind(window),cancelAnimationFrame:window.cancelAnimationFrame.bind(window)});
  const field=document.querySelector('textarea');let edits=0;field.addEventListener('input',()=>edits++);const editor=mountCodeEditor(field);
  try{
    const view=EditorView.findFromDOM(document.querySelector('.cm-editor'));
    view.dispatch({selection:{anchor:0,head:6}});const cursor=editor.getCursor();assert.equal(cursor,6);
    assert.equal(editor.insertText('# código 🐍\n',cursor),true);assert.equal(field.value,'antes # código 🐍\ndespués');assert.equal(edits,1);
    document.querySelector('.cm-content').dispatchEvent(new window.KeyboardEvent('keydown',{key:'z',code:'KeyZ',ctrlKey:true,bubbles:true,cancelable:true}));
    assert.equal(field.value,'antes después');assert.equal(edits,2);
    field.readOnly=true;assert.equal(editor.insertText('NO'),false);assert.equal(field.value,'antes después');
  }finally{editor.destroy();dom.window.close();}
});
