import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {memoryAccountStore} from './helpers/account-store.mjs';
import {createAccountsService} from '../accounts/service.mjs';
import {createActivitiesService} from '../accounts/activities.mjs';
import {newActivity,initialAnswer} from '../dist/activity-model.js';
import {DraftSync} from '../accounts-public/draft-sync.js';
import {OfflineWorkspace,indexedStore} from '../accounts-public/offline-store.js';
import {syncPending} from '../accounts-public/pwa.js';
import {IDBFactory} from 'fake-indexeddb';

test('copias offline retiradas se purgan y un borrador de inscripción anterior no se sincroniza al volver a añadir',async()=>{
 const profile={id:'pupil',role:'student'},snapshot=newActivity(),answer=initialAnswer(snapshot),workspace=new OfflineWorkspace(indexedStore(new IDBFactory()));
 const opened={assignment:{id:'one',snapshot,work_version:'old'},answer,revision:0,writable:true};
 await workspace.prepare(profile,{}, {assignments:[{id:'one'},{id:'two'}]},{groups:[]},[opened,{...opened,assignment:{...opened.assignment,id:'two'}}]);
 await workspace.remember(profile,'activities',undefined,{assignments:[{id:'two'}]});assert.equal(await workspace.read(profile,'activity-open',{assignmentId:'one'}),null);assert.ok(await workspace.read(profile,'activity-open',{assignmentId:'two'}));
 const records=new Map(),storage={get length(){return records.size;},key:i=>[...records.keys()][i],getItem:k=>records.get(k),setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};
 const dirty=structuredClone(answer);dirty.cells[1].code='no debe resucitar';const key='aula-answer:pupil:one';records.set(key,JSON.stringify({answer:dirty,dirty:true,revision:0,context:'old'}));let writes=0;
 const api=async path=>{if(path==='me')return {profile};if(path==='activity-open')return {...opened,assignment:{...opened.assignment,work_version:'new'}};writes++;throw new Error('No debe guardar el borrador eliminado');};
 await syncPending({profile,storage,api});assert.equal(writes,0);assert.equal(records.size,0);
 await workspace.forgetAssignment(profile,'two');assert.equal(await workspace.read(profile,'activity-open',{assignmentId:'two'}),null);
});

test('quitar del grupo borra solo sus trabajos y bloquea la restauración desde un borrador de la inscripción anterior',async()=>{
 const store=memoryAccountStore();const teacher=await store.createUser({role:'teacher',email:'teacher@test.invalid',password:'TestPassword1234',name:'Docente'}),service=createAccountsService(store),activities=createActivitiesService(store);
 const a=await service.createGroup(teacher,'A'),b=await service.createGroup(teacher,'B');
 const imported=await service.importStudents(teacher,[{control:'001',name:'Ana'},{control:'002',name:'Luis'}],a.id);const student=await store.profile(imported.created[0].id),peer=await store.profile(imported.created[1].id);assert.equal((await store.studentGroups(student.id)).length,0);
 for(const s of [student,peer]){await store.updateProfile(s.id,{must_change_password:false});s.must_change_password=false;await service.membership(teacher,a.id,s.id,true);}await service.membership(teacher,b.id,student.id,true);
 const template=await activities.saveActivity(teacher,newActivity()),assigned=await activities.assign(teacher,{activityId:template.id,version:1,groupIds:[a.id,b.id]}),one=assigned[0].id,two=assigned[1].id,answer=initialAnswer(template);answer.cells[1].code='codigo anterior = 42';
 await activities.saveAnswer(student,{assignmentId:one,revision:0,answer,submit:true});
 const dueAt=new Date(Date.now()+86400000).toISOString();await activities.review(teacher,{assignmentId:one,studentId:student.id,revision:1,action:'return',grade:null,feedback:'Corrige',correctionDueAt:dueAt});
 await activities.setStudentDeadline(teacher,{assignmentId:one,studentId:student.id,dueAt});
 await activities.saveAnswer(student,{assignmentId:two,revision:0,answer,submit:false});await activities.saveAnswer(peer,{assignmentId:one,revision:0,answer,submit:false});
 const otherWork=await store.submission(two,student.id),peerWork=await store.submission(one,peer.id);
 await assert.rejects(service.membership(teacher,a.id,student.id,false),e=>e.status===409);assert.ok(await store.submission(one,student.id));
 await service.membership(teacher,a.id,student.id,false,true);
 assert.equal(await store.submission(one,student.id),undefined);assert.equal((await store.reviewSummaries(one,student.id)).length,0);assert.equal(await store.studentDeadline(one,student.id),null);
 assert.deepEqual(await store.submission(two,student.id),otherWork);assert.deepEqual(await store.submission(one,peer.id),peerWork);assert.ok(await store.profile(student.id));assert.equal((await store.listActivities(teacher.id)).length,1);
 await assert.rejects(activities.open(student,one),e=>e.status===404);await service.membership(teacher,a.id,student.id,true);
 const opened=await activities.open(student,one);assert.ok(opened.assignment.work_version);assert.equal(opened.revision,0);
 await assert.rejects(activities.saveAnswer(student,{assignmentId:one,revision:0,answer,submit:false}),e=>e.status===409);
 const records=new Map([['draft',JSON.stringify({dirty:true,revision:0,answer})]]),storage={getItem:k=>records.get(k),removeItem:k=>records.delete(k)};
 const draft=new DraftSync({key:'draft',answer:opened.answer,revision:0,storage,context:opened.assignment.work_version});assert.equal(draft.dirty,false);assert.equal(draft.contextChanged,true);assert.equal(records.size,0);
 await activities.saveAnswer(student,{assignmentId:one,revision:0,answer:opened.answer,submit:false,workVersion:opened.assignment.work_version});assert.deepEqual((await store.submission(one,student.id)).answer,opened.answer);
});

test('PostgreSQL: migración conserva registros; baja atómica limpia revisiones y plazos sin afectar otros grupos ni alumnos', {timeout:60000},async()=>{
 const db=new PGlite(),teacher='00000000-0000-4000-8000-000000000001',student='00000000-0000-4000-8000-000000000002',peer='00000000-0000-4000-8000-000000000003';
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_app_meta_data jsonb,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;`);
  for(const name of ['202610170001_accounts.sql','202610170003_activities.sql','202610170004_reviews.sql','202610170005_efficient_sync.sql','202610240001_assignment_delete.sql','202611030001_conflict_sqlstate.sql','202611040001_student_deadlines.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  for(const[id,metadata]of [[teacher,{aula_role:'teacher',aula_name:'Docente'}],[student,{aula_role:'student',aula_name:'Ana',aula_control:'001',aula_teacher_id:teacher}],[peer,{aula_role:'student',aula_name:'Luis',aula_control:'002',aula_teacher_id:teacher}]])await db.query('insert into auth.users(id,raw_app_meta_data)values($1,$2)',[id,JSON.stringify(metadata)]);
  await db.exec('update aula_profiles set must_change_password=false');
  const groups=[];for(const name of ['A','B'])groups.push((await db.query('insert into aula_groups(teacher_id,name)values($1,$2)returning id',[teacher,name])).rows[0].id);
  for(const[g,s]of [[groups[0],student],[groups[1],student],[groups[0],peer]])await db.query('insert into aula_memberships(group_id,student_id)values($1,$2)',[g,s]);
  const activity=newActivity(),answer=initialAnswer(activity),id=(await db.query("insert into aula_activities(teacher_id,title,kind,content)values($1,'Prueba','notebook',$2)returning id",[teacher,JSON.stringify(activity.content)])).rows[0].id,assignments=[];
  for(const group of groups)assignments.push((await db.query('insert into aula_assignments(activity_id,teacher_id,group_id,activity_version,snapshot)values($1,$2,$3,1,$4)returning id',[id,teacher,group,JSON.stringify(activity)])).rows[0].id);
  const save=(a,s,revision,submit=false)=>db.query('select aula_save_answer($1,$2,$3,$4,$5)',[a,s,revision,JSON.stringify(answer),submit]);
  for(const[a,s]of [[assignments[0],student],[assignments[1],student],[assignments[0],peer]])await save(a,s,0);
  await db.query("select aula_set_student_deadline($1,$2,$3,now()+interval '1 day')",[assignments[0],student,teacher]);await save(assignments[0],student,1,true);
  await db.query("select aula_review_answer($1,$2,$3,2,'review',90,'Bien',null)",[assignments[0],student,teacher]);
  const before=(await db.query('select * from aula_submissions order by assignment_id,student_id')).rows;
  const sql=await readFile(new URL('../supabase/migrations/202611040002_group_membership_cleanup.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
  assert.deepEqual((await db.query('select * from aula_submissions order by assignment_id,student_id')).rows,before);assert.ok((await db.query('select work_version from aula_memberships')).rows.every(r=>r.work_version===null));
  await db.query('select aula_save_member_answer($1,$2,1,$3,false,null)',[assignments[1],student,JSON.stringify(answer)]);
  const unaffected=(await db.query('select * from aula_submissions where assignment_id=$1 or student_id=$2 order by assignment_id,student_id',[assignments[1],peer])).rows;
  await assert.rejects(db.query('select aula_remove_group_student($1,$2,$3)',[groups[0],student,peer]),e=>e.code==='42501');
  await db.query('select aula_remove_group_student($1,$2,$3)',[groups[0],student,teacher]);
  assert.equal((await db.query('select * from aula_submissions where assignment_id=$1 and student_id=$2',[assignments[0],student])).rows.length,0);
  assert.equal((await db.query('select * from aula_reviews')).rows.length,0);assert.equal((await db.query('select * from aula_student_deadlines')).rows.length,0);
  assert.deepEqual((await db.query('select * from aula_submissions where assignment_id=$1 or student_id=$2 order by assignment_id,student_id',[assignments[1],peer])).rows,unaffected);
  assert.equal((await db.query('select * from aula_activities')).rows.length,1);assert.equal((await db.query('select * from aula_assignments')).rows.length,2);assert.equal((await db.query('select * from aula_profiles')).rows.length,3);
  await db.query('insert into aula_memberships(group_id,student_id)values($1,$2)',[groups[0],student]);const version=(await db.query('select work_version from aula_memberships where group_id=$1 and student_id=$2',[groups[0],student])).rows[0].work_version;assert.ok(version);
  await assert.rejects(db.query('select aula_save_member_answer($1,$2,0,$3,false,null)',[assignments[0],student,JSON.stringify(answer)]),e=>e.code==='PT409');
  await db.query('select aula_save_member_answer($1,$2,0,$3,false,$4)',[assignments[0],student,JSON.stringify(answer),version]);
  assert.equal((await db.query("select has_function_privilege('authenticated','aula_remove_group_student(uuid,uuid,uuid)','execute') as allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
