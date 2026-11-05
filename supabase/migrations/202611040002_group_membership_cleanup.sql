begin;
-- Existing memberships and drafts remain valid. Only new memberships receive
-- a new generation, preventing an old offline draft from reviving deleted work.
alter table public.aula_memberships add column if not exists work_version uuid;
alter table public.aula_memberships alter column work_version set default gen_random_uuid();

create or replace function public.aula_remove_group_student(group_key uuid, student_key uuid, teacher_key uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare removed integer;
begin
  perform 1 from aula_groups where id = group_key and teacher_id = teacher_key for share;
  if not found or not exists(select 1 from aula_profiles where id = teacher_key and role = 'teacher' and active)
    or not exists(select 1 from aula_profiles where id = student_key and role = 'student' and teacher_id = teacher_key) then
    raise exception 'Alumno o grupo sin acceso' using errcode = '42501';
  end if;
  -- Same lock order as saves/reviews: assignment then membership. An in-flight
  -- save finishes before deletion; subsequent saves see the missing membership.
  perform id from aula_assignments where group_id = group_key order by id for update;
  perform 1 from aula_memberships where group_id = group_key and student_id = student_key for update;
  delete from aula_student_deadlines d using aula_assignments a
    where d.assignment_id = a.id and a.group_id = group_key and d.student_id = student_key;
  -- The existing FK cascades each submission's review history.
  delete from aula_submissions s using aula_assignments a
    where s.assignment_id = a.id and a.group_id = group_key and s.student_id = student_key;
  get diagnostics removed = row_count;
  delete from aula_memberships where group_id = group_key and student_id = student_key;
  return jsonb_build_object('removedSubmissions', removed);
end $$;
revoke all on function public.aula_remove_group_student(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.aula_remove_group_student(uuid,uuid,uuid) to service_role;

create or replace function public.aula_check_member_work(assignment_key uuid, student_key uuid, expected_version uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare group_key uuid; current_version uuid;
begin
  select group_id into group_key from aula_assignments where id = assignment_key for share;
  if not found then raise exception 'Actividad sin acceso' using errcode = '42501'; end if;
  select work_version into current_version from aula_memberships where group_id = group_key and student_id = student_key for share;
  if not found then raise exception 'Ya no perteneces al grupo de esta actividad' using errcode = '42501'; end if;
  if current_version is distinct from expected_version then
    raise exception 'La pertenencia al grupo cambió. Recarga la actividad; los trabajos eliminados no pueden restaurarse desde una copia anterior.' using errcode = 'PT409';
  end if;
end $$;
revoke all on function public.aula_check_member_work(uuid,uuid,uuid) from public, anon, authenticated, service_role;

create or replace function public.aula_save_member_answer(assignment_key uuid, student_key uuid, expected_revision integer, answer_value jsonb, final_submit boolean, work_version uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform aula_check_member_work(assignment_key,student_key,work_version);
  return aula_save_answer(assignment_key,student_key,expected_revision,answer_value,final_submit);
end $$;
create or replace function public.aula_patch_member_answer(assignment_key uuid, student_key uuid, expected_revision integer, answer_patch jsonb, request_key uuid, final_submit boolean, work_version uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform aula_check_member_work(assignment_key,student_key,work_version);
  return aula_patch_answer(assignment_key,student_key,expected_revision,answer_patch,request_key,final_submit);
end $$;
revoke all on function public.aula_save_member_answer(uuid,uuid,integer,jsonb,boolean,uuid), public.aula_patch_member_answer(uuid,uuid,integer,jsonb,uuid,boolean,uuid) from public, anon, authenticated;
grant execute on function public.aula_save_member_answer(uuid,uuid,integer,jsonb,boolean,uuid), public.aula_patch_member_answer(uuid,uuid,integer,jsonb,uuid,boolean,uuid) to service_role;
commit;
