begin;

-- Exceptions are separate from submissions: granting time never creates a
-- draft, changes a revision or marks an activity as started/delivered.
create table if not exists public.aula_student_deadlines (
  assignment_id uuid not null references public.aula_assignments(id) on delete cascade,
  student_id uuid not null references public.aula_profiles(id) on delete cascade,
  due_at timestamptz not null,
  primary key (assignment_id, student_id)
);
alter table public.aula_student_deadlines enable row level security;
revoke all on public.aula_student_deadlines from public, anon, authenticated;
grant all on public.aula_student_deadlines to service_role;
create index if not exists aula_student_deadlines_student_idx on public.aula_student_deadlines(student_id);

create or replace function public.aula_set_student_deadline(assignment_key uuid, student_key uuid, teacher_key uuid, deadline timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare assignment public.aula_assignments;
begin
  select * into assignment from aula_assignments where id = assignment_key for share;
  if not found or assignment.teacher_id <> teacher_key or not exists(
    select 1 from aula_profiles where id = teacher_key and role = 'teacher' and active
  ) or not exists(
    select 1 from aula_profiles p join aula_memberships m on m.student_id = p.id
    where p.id = student_key and p.role = 'student' and p.active and p.teacher_id = teacher_key and m.group_id = assignment.group_id
  ) then raise exception 'No tienes acceso a este alumno o actividad' using errcode = '42501'; end if;
  if assignment.closed then raise exception 'Reabre la actividad antes de cambiar el plazo individual' using errcode = 'PT409'; end if;
  perform 1 from aula_submissions where assignment_id = assignment_key and student_id = student_key for update;
  if exists(select 1 from aula_submissions where assignment_id = assignment_key and student_id = student_key and submitted_at is not null) then
    raise exception 'La respuesta ya fue entregada. Devuélvela para correcciones.' using errcode = 'PT409';
  end if;
  if deadline is not null and deadline <= now() then raise exception 'El plazo individual debe estar en el futuro' using errcode = '22023'; end if;
  if deadline is null then
    delete from aula_student_deadlines where assignment_id = assignment_key and student_id = student_key;
  else
    insert into aula_student_deadlines(assignment_id,student_id,due_at) values(assignment_key,student_key,deadline)
      on conflict(assignment_id,student_id) do update set due_at = excluded.due_at;
  end if;
  return jsonb_build_object('due_at',deadline);
end $$;
revoke all on function public.aula_set_student_deadline(uuid,uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.aula_set_student_deadline(uuid,uuid,uuid,timestamptz) to service_role;

-- Preserve the deployed function bodies, existing data and non-retryable PT409
-- conflicts. Patch only deadline selection and summary output, idempotently.
do $migration$
declare definition text; previous text;
begin
  definition := pg_get_functiondef('public.aula_save_answer(uuid,uuid,integer,jsonb,boolean)'::regprocedure);
  if position('aula_student_deadlines' in definition) = 0 then
    previous := definition;
    definition := replace(definition,
      'deadline := case when current_answer.returned_at is not null then current_answer.correction_due_at else assignment.due_at end;',
      'deadline := coalesce((select d.due_at from aula_student_deadlines d where d.assignment_id = assignment_key and d.student_id = student_key), case when current_answer.returned_at is not null then current_answer.correction_due_at else assignment.due_at end);');
    if definition = previous then raise exception 'No se encontró la selección de plazo en aula_save_answer'; end if;
    execute definition;
  end if;
  definition := pg_get_functiondef('public.aula_review_answer(uuid,uuid,uuid,integer,text,numeric,text,timestamptz)'::regprocedure);
  if position('aula_student_deadlines' in definition) = 0 then
    previous := definition;
    definition := replace(definition, 'insert into aula_reviews(',
      'if review_action = ''return'' then delete from aula_student_deadlines where assignment_id = assignment_key and student_id = student_key; end if; insert into aula_reviews(');
    if definition = previous then raise exception 'No se encontró la revisión en aula_review_answer'; end if;
    execute definition;
  end if;
  definition := pg_get_functiondef('public.aula_progress_summary(uuid,uuid,text)'::regprocedure);
  if position('individual_due_at' in definition) = 0 then
    previous := definition;
    definition := replace(definition, '''active'',p.active,',
      '''active'',p.active,''individual_due_at'',(select d.due_at from aula_student_deadlines d where d.assignment_id = assignment_key and d.student_id = p.id),');
    if definition = previous then raise exception 'No se encontró el resumen de aula_progress_summary'; end if;
    execute definition;
  end if;
end $migration$;
commit;
