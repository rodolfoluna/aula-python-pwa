import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { JSDOM } from 'jsdom';
import { createActivitiesService } from '../accounts/activities.mjs';
import { memoryAccountStore } from './helpers/account-store.mjs';
import { newActivity, initialAnswer } from '../dist/activity-model.js';
import { setupActivities } from '../accounts-public/activities.js';
import { OfflineWorkspace, indexedStore } from '../accounts-public/offline-store.js';
import { IDBFactory } from 'fake-indexeddb';

test('plazo individual sin iniciar: permisos, grupo vencido, guardado, entrega y copia offline', async () => {
  const store=memoryAccountStore(), now=Date.now(), service=createActivitiesService(store,()=>now);
  const user=async(role,name,teacherId)=>store.createUser({email:name+'@test.invalid',password:'SoloPrueba123456',role,name,teacherId,control:name});
  const teacher=await user('teacher','Docente'), other=await user('teacher','Ajeno');
  const student=await user('student','Ana',teacher.id), peer=await user('student','Luis',teacher.id);
  const group=await store.createGroup(teacher.id,'A');for(const s of [student,peer]){await store.setMembership(group.id,s.id,true);await store.updateProfile(s.id,{must_change_password:false});s.must_change_password=false;}
  const activity=await service.saveActivity(teacher,newActivity()),[assignment]=await service.assign(teacher,{activityId:activity.id,version:1,groupIds:[group.id]});
  await service.setDeadline(teacher,{assignmentId:assignment.id,dueAt:new Date(now-1000).toISOString()});
  const request={assignmentId:assignment.id,studentId:student.id,dueAt:new Date(now+86400000).toISOString()};
  await assert.rejects(service.setStudentDeadline(student,request),e=>e.status===403);
  await assert.rejects(service.setStudentDeadline(other,request),e=>e.status===404);
  await assert.rejects(service.setStudentDeadline(teacher,{...request,dueAt:'invalid'}),e=>e.status===400);
  await assert.rejects(service.setStudentDeadline(teacher,{...request,dueAt:new Date(now-1).toISOString()}),e=>e.status===400);
  await service.setStudentDeadline(teacher,request);
  assert.equal(await store.submission(assignment.id,student.id),undefined,'No crea una respuesta ni marca inicio');
  const opened=await service.open(student,assignment.id);assert.equal(opened.writable,true);
  assert.equal((await service.open(peer,assignment.id)).writable,false);
  assert.equal((await service.list(student)).assignments[0].individual_due_at,request.dueAt);
  const workspace=new OfflineWorkspace(indexedStore(new IDBFactory()));await workspace.prepare(student,{}, {assignments:[]},{groups:[]},[opened]);
  assert.equal((await workspace.read(student,'activity-open',{assignmentId:assignment.id})).writable,true);
  const answer=initialAnswer(activity);answer.cells[1].code='avance = 42';
  await service.saveAnswer(student,{assignmentId:assignment.id,revision:0,answer,submit:false});
  const before=await store.submission(assignment.id,student.id);
  await service.setStudentDeadline(teacher,{...request,dueAt:new Date(now+3600000).toISOString()});
  assert.deepEqual(await store.submission(assignment.id,student.id),before);
  await service.setStudentDeadline(teacher,{...request,dueAt:null});assert.equal((await service.open(student,assignment.id)).writable,false);
  await service.setStudentDeadline(teacher,request);
  await service.saveAnswer(student,{assignmentId:assignment.id,revision:1,answer,submit:true});
  await assert.rejects(service.setStudentDeadline(teacher,request),e=>e.status===409);
  const originalAssignment=await store.assignment(assignment.id);assert.equal(originalAssignment.due_at,new Date(now-1000).toISOString());
});

test('profesor cambia el plazo desde avances de un alumno sin entrega', async () => {
  const previous={window:globalThis.window,document:globalThis.document,location:globalThis.location,localStorage:globalThis.localStorage};
  const dom=new JSDOM(await readFile(new URL('../accounts-public/index.html',import.meta.url),'utf8'),{url:'https://aula.test'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,localStorage:dom.window.localStorage,confirm:()=>true});
  const teacher={id:'teacher',role:'teacher'}, assignment={id:'assignment',due_at:'2026-01-01T00:00:00Z',closed:false};
  const students=[{id:'one',control:'001',name:'Ana',active:true,submission:null},{id:'two',control:'002',name:'Luis',active:true,submission:null}];let payload;
  const api=async(path,data)=>{
    if(path==='activities')return {activities:[],assignments:[{...assignment,title:'Prueba'}]};
    if(path==='activity-progress')return {assignment,students,token:'changed'};
    if(path==='student-deadline'){payload=data;students[0].individual_due_at=data.dueAt;return {};}
    throw new Error(path);
  };
  const activities=setupActivities({api,perform:fn=>fn(),getProfile:()=>teacher,getGroups:()=>[],getRunnerOrigin:()=> 'https://runner.test'});
  const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
  try{
    await activities.setSession(teacher);await button('Actividades y avances').onclick();await button('Ver avances').onclick();
    const row=document.querySelector('.progress-row');assert.match(row.textContent,/Sin iniciar/);
    await row.querySelector('button:last-child').onclick();const form=row.querySelector('form');assert.ok(form);
    form.querySelector('input').value='2030-01-02T12:00';form.dispatchEvent(new window.Event('submit',{cancelable:true}));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(payload.studentId,'one');assert.equal(payload.assignmentId,'assignment');assert.ok(payload.dueAt.includes('2030-01-02'));
    assert.match(document.querySelector('.progress-row').textContent,/Plazo individual/);assert.equal(students[1].individual_due_at,undefined);
  }finally{await activities.setSession(null);dom.window.close();Object.assign(globalThis,previous);}
});

test('PostgreSQL: excepción individual atómica, sin respuesta previa y sin afectar revisiones ni compañeros', {timeout:60000}, async()=>{
  const db=new PGlite(), teacher='00000000-0000-4000-8000-000000000001', student='00000000-0000-4000-8000-000000000002', peer='00000000-0000-4000-8000-000000000003';
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_app_meta_data jsonb,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;`);
    for(const file of ['202610170001_accounts.sql','202610170003_activities.sql','202610170004_reviews.sql','202610170005_efficient_sync.sql','202610240001_assignment_delete.sql','202611030001_conflict_sqlstate.sql','202611040001_student_deadlines.sql','202611040001_student_deadlines.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    for(const [id,metadata]of [[teacher,{aula_role:'teacher',aula_name:'Docente'}],[student,{aula_role:'student',aula_name:'Ana',aula_control:'001',aula_teacher_id:teacher}],[peer,{aula_role:'student',aula_name:'Luis',aula_control:'002',aula_teacher_id:teacher}]])await db.query('insert into auth.users(id,raw_app_meta_data)values($1,$2)',[id,JSON.stringify(metadata)]);
    await db.exec('update aula_profiles set must_change_password=false');
    const group=(await db.query("insert into aula_groups(teacher_id,name)values($1,'A')returning id",[teacher])).rows[0].id;
    for(const id of [student,peer])await db.query('insert into aula_memberships values($1,$2)',[group,id]);
    const activity=newActivity(), answer=initialAnswer(activity);
    const activityId=(await db.query("insert into aula_activities(teacher_id,title,kind,content)values($1,'Prueba','notebook',$2)returning id",[teacher,JSON.stringify(activity.content)])).rows[0].id;
    const assignment=(await db.query("insert into aula_assignments(activity_id,teacher_id,group_id,activity_version,snapshot,due_at)values($1,$2,$3,1,$4,now()-interval '1 day')returning id",[activityId,teacher,group,JSON.stringify(activity)])).rows[0].id;
    const set=due=>db.query('select aula_set_student_deadline($1,$2,$3,$4)',[assignment,student,teacher,due]);
    const save=(id,revision,submit=false)=>db.query('select aula_save_answer($1,$2,$3,$4,$5)',[assignment,id,revision,JSON.stringify(answer),submit]);
    const future=new Date(Date.now()+86400000).toISOString();
    await set(future);assert.equal((await db.query('select * from aula_submissions')).rows.length,0);
    assert.equal((await db.query('select aula_progress_summary($1,$2,null) as summary',[assignment,teacher])).rows[0].summary.students.find(s=>s.id===student).individual_due_at!==null,true);
    await assert.rejects(save(peer,0),/vencida/);await save(student,0);
    const before=(await db.query('select * from aula_submissions where student_id=$1',[student])).rows[0];
    await set(new Date(Date.now()+3600000).toISOString());assert.deepEqual((await db.query('select * from aula_submissions where student_id=$1',[student])).rows[0],before);
    await set(null);await assert.rejects(save(student,1),/vencida/);await set(future);await save(student,1,true);
    await assert.rejects(set(future),e=>e.code==='PT409');
    await db.query("select aula_review_answer($1,$2,$3,2,'return',null,'Corrige',$4)",[assignment,student,teacher,future]);
    assert.equal((await db.query('select * from aula_student_deadlines')).rows.length,0);await save(student,3);
    assert.equal((await db.query("select has_function_privilege('authenticated','aula_set_student_deadline(uuid,uuid,uuid,timestamptz)','execute') as allowed")).rows[0].allowed,false);
    await assert.rejects(db.query('select aula_set_student_deadline($1,$2,$3,$4)',[assignment,student,peer,future]),e=>e.code==='42501');
    await set(future);await db.query('delete from aula_assignments where id=$1',[assignment]);assert.equal((await db.query('select * from aula_student_deadlines')).rows.length,0);
  }finally{await db.close();}
});
