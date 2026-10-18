begin;
alter table public.aula_submissions add column last_save_id uuid, add column last_save_hash text, add column last_save_receipt jsonb;
create function public.aula_clear_save_receipt() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.revision <> old.revision then new.last_save_id := null; new.last_save_hash := null; new.last_save_receipt := null; end if;
  return new;
end $$;
revoke all on function public.aula_clear_save_receipt() from public;
create trigger aula_clear_save_receipt before update on public.aula_submissions for each row execute function public.aula_clear_save_receipt();

create function public.aula_patch_answer(assignment_key uuid, student_key uuid, expected_revision integer,
  answer_patch jsonb, request_key uuid, final_submit boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare assignment public.aula_assignments; current_answer public.aula_submissions; merged jsonb; change jsonb;
  keys text[]; receipt jsonb; request_hash text;
begin
  select * into assignment from aula_assignments where id = assignment_key for share;
  if not found or not exists(select 1 from aula_profiles p join aula_memberships m on m.student_id = p.id
    where p.id = student_key and p.role = 'student' and p.active and not p.must_change_password and m.group_id = assignment.group_id) then
    raise exception 'No tienes acceso a esta actividad' using errcode = '42501';
  end if;
  if request_key is null or expected_revision is null or expected_revision < 0 or final_submit is null or
    jsonb_typeof(answer_patch->'changes') is distinct from 'array' then raise exception 'Cambios inválidos' using errcode = '22023'; end if;
  if jsonb_array_length(answer_patch->'changes') > 1024 then raise exception 'Demasiados cambios' using errcode = '22023'; end if;
  request_hash := md5(jsonb_build_array(expected_revision,answer_patch,final_submit)::text);
  select * into current_answer from aula_submissions where assignment_id = assignment_key and student_id = student_key for update;
  if found and current_answer.last_save_id = request_key then
    if current_answer.last_save_hash <> request_hash then raise exception 'El identificador ya pertenece a otro guardado' using errcode = '40001'; end if;
    return current_answer.last_save_receipt;
  end if;
  if not found then
    if expected_revision <> 0 or jsonb_array_length(answer_patch->'changes') <> 1 or answer_patch->'changes'->0->'path' <> '[]'::jsonb then
      raise exception 'El primer guardado necesita una respuesta completa' using errcode = '40001'; end if;
    merged := answer_patch->'changes'->0->'value';
    insert into aula_submissions(assignment_id,student_id,answer,revision) values(assignment_key,student_key,merged,0) on conflict do nothing;
    select * into current_answer from aula_submissions where assignment_id = assignment_key and student_id = student_key for update;
    if current_answer.last_save_id = request_key and current_answer.last_save_hash = request_hash then return current_answer.last_save_receipt; end if;
  end if;
  if current_answer.revision <> expected_revision then raise exception 'Hay cambios en otra sesión. Recarga antes de guardar.' using errcode = '40001'; end if;
  merged := current_answer.answer;
  for change in select value from jsonb_array_elements(answer_patch->'changes') loop
    if jsonb_typeof(change->'path') is distinct from 'array' then raise exception 'Ruta inválida' using errcode = '22023'; end if;
    select array_agg(value order by ordinality) into keys from jsonb_array_elements_text(change->'path') with ordinality;
    if coalesce(array_length(keys,1),0) > 12 then raise exception 'Ruta inválida' using errcode = '22023'; end if;
    if coalesce(array_length(keys,1),0) = 0 then
      if change->'remove' = 'true'::jsonb or not(change ? 'value') then raise exception 'Respuesta inválida' using errcode = '22023'; end if;
      merged := change->'value';
    elsif change->'remove' = 'true'::jsonb then merged := merged #- keys;
    else merged := jsonb_set(merged,keys,change->'value',true);
    end if;
  end loop;
  receipt := aula_save_answer(assignment_key,student_key,expected_revision,merged,final_submit);
  update aula_submissions set last_save_id = request_key, last_save_hash = request_hash, last_save_receipt = receipt
    where assignment_id = assignment_key and student_id = student_key;
  return receipt;
end $$;
revoke all on function public.aula_patch_answer(uuid,uuid,integer,jsonb,uuid,boolean) from public, anon, authenticated;
grant execute on function public.aula_patch_answer(uuid,uuid,integer,jsonb,uuid,boolean) to service_role;

create function public.aula_progress_summary(assignment_key uuid, teacher_key uuid, known_token text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare assignment public.aula_assignments; rows jsonb; token text;
begin
  select * into assignment from aula_assignments where id = assignment_key;
  if not found or assignment.teacher_id <> teacher_key or not exists(select 1 from aula_profiles where id = teacher_key and role = 'teacher' and active) then
    raise exception 'Actividad no encontrada o sin acceso' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'control',p.control,'name',p.name,'active',p.active,
    'submission',case when s.student_id is null then null else jsonb_build_object('student_id',s.student_id,'revision',s.revision,
      'updated_at',s.updated_at,'submitted_at',s.submitted_at,'grade',s.grade,'reviewed_at',s.reviewed_at,
      'returned_at',s.returned_at,'correction_due_at',s.correction_due_at) end) order by p.name,p.id),'[]'::jsonb)
    into rows from aula_profiles p left join aula_submissions s on s.student_id = p.id and s.assignment_id = assignment_key
    where p.role = 'student' and p.teacher_id = teacher_key and (s.student_id is not null or exists(
      select 1 from aula_memberships m where m.student_id = p.id and m.group_id = assignment.group_id));
  token := md5(jsonb_build_array(rows,assignment.closed,assignment.due_at)::text);
  if token = known_token then return jsonb_build_object('unchanged',true,'token',token); end if;
  return jsonb_build_object('unchanged',false,'token',token,'assignment',to_jsonb(assignment)-'snapshot','students',rows);
end $$;
revoke all on function public.aula_progress_summary(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.aula_progress_summary(uuid,uuid,text) to service_role;
commit;
