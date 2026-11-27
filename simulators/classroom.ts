import * as family from './family-budget';
import * as topic from './topic45';
let selected:i32=0;
export function init(program:i32):void { selected=program; if(program>=100)topic.init(program);else family.init(program); }
export function allocInput(length:i32):usize { return selected>=100?topic.allocInput(length):family.allocInput(length); }
export function submit(length:i32):void { if(selected>=100)topic.submit(length);else family.submit(length); }
export function resultPointer():usize { return selected>=100?topic.resultPointer():family.resultPointer(); }
export function resultLength():i32 { return selected>=100?topic.resultLength():family.resultLength(); }
