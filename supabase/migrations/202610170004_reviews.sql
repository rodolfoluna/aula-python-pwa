begin;
alter table public.aula_submissions
  add column grade numeric(5,2) check (grade between 0 and 100),
  add column feedback text not null default '' check (length(feedback) <= 10000),
  add column reviewed_at timestamptz,
  add column returned_at timestamptz,
  add column correction_due_at timestamptz;

-- Una copia por revisión docente, no por cada autoguardado del alumno.
create table public.aula_reviews (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null, student_id uuid not null,
  teacher_id uuid not null references public.aula_profiles(id),
  submission_revision integer not null,
  action text not null check(action in ('review','return')),
  grade numeric(5,2) check(grade between 0 and 100),
  feedback text not null check(length(feedback) <= 10000),
  answer jsonb not null, submitted_at timestamptz not null,
  correction_due_at timestamptz, created_at timestamptz not null default now(),
  foreign key(assignment_id,student_id) references public.aula_submissions(assignment_id,student_id)
);
create index aula_reviews_submission_idx on public.aula_reviews(assignment_id,student_id,created_at desc);
alter table public.aula_reviews enable row level security;
revoke all on public.aula_reviews from anon, authenticated;
grant select on public.aula_reviews to authenticated;
grant select, insert on public.aula_reviews to service_role;
create policy aula_reviews_read on public.aula_reviews for select to authenticated using(
  (student_id = auth.uid() and aula_ready_student() and aula_can_read_assignment(assignment_id)) or
  (teacher_id = auth.uid() and aula_is_teacher())
);

create function public.aula_review_answer(assignment_key uuid, student_key uuid, teacher_key uuid,
  expected_revision integer, review_action text, grade_value numeric, feedback_value text, correction_deadline timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare assignment public.aula_assignments; current_answer public.aula_submissions; review_id uuid;
begin
  select * into assignment from aula_assignments where id = assignment_key for share;
  if not found or assignment.teacher_id <> teacher_key or not exists(
    select 1 from aula_profiles where id = teacher_key and role = 'teacher' and active
  ) then raise exception 'No tienes acceso a esta entrega' using errcode = '42501'; end if;
  if review_action is null or review_action not in ('review','return') or feedback_value is null or length(feedback_value) > 10000
    or (grade_value is not null and (grade_value < 0 or grade_value > 100 or grade_value <> round(grade_value,2))) then
    raise exception 'Calificación o comentarios inválidos' using errcode = '22023';
  end if;
  select * into current_answer from aula_submissions where assignment_id = assignment_key and student_id = student_key for update;
  if not found or current_answer.submitted_at is null then raise exception 'El alumno debe entregar antes de revisar o devolver' using errcode = '42501'; end if;
  if expected_revision is null or current_answer.revision <> expected_revision then raise exception 'La entrega cambió. Vuelve a abrirla antes de revisar.' using errcode = '40001'; end if;
  if review_action = 'return' then
    if assignment.closed then raise exception 'Reabre la actividad antes de devolverla' using errcode = '42501'; end if;
    if correction_deadline is null or correction_deadline <= now() or length(trim(feedback_value)) = 0 or not exists(
      select 1 from aula_profiles p join aula_memberships m on m.student_id = p.id
      where p.id = student_key and p.active and p.role = 'student' and not p.must_change_password and m.group_id = assignment.group_id
    ) then raise exception 'Para devolver se necesitan comentarios, plazo futuro y un alumno activo en el grupo' using errcode = '22023'; end if;
  end if;
  insert into aula_reviews(assignment_id,student_id,teacher_id,submission_revision,action,grade,feedback,answer,submitted_at,correction_due_at)
    values(assignment_key,student_key,teacher_key,current_answer.revision,review_action,grade_value,feedback_value,current_answer.answer,current_answer.submitted_at,
      case when review_action = 'return' then correction_deadline else null end) returning id into review_id;
  update aula_submissions set grade = grade_value, feedback = feedback_value, reviewed_at = now(), revision = revision + 1,
    submitted_at = case when review_action = 'return' then null else submitted_at end,
    returned_at = case when review_action = 'return' then now() else returned_at end,
    correction_due_at = case when review_action = 'return' then correction_deadline else correction_due_at end
    where assignment_id = assignment_key and student_id = student_key;
  return jsonb_build_object('review_id',review_id,'revision',current_answer.revision + 1);
end $$;
revoke all on function public.aula_review_answer(uuid,uuid,uuid,integer,text,numeric,text,timestamptz) from public, anon, authenticated;
grant execute on function public.aula_review_answer(uuid,uuid,uuid,integer,text,numeric,text,timestamptz) to service_role;

create or replace function public.aula_save_answer(assignment_key uuid, student_key uuid, expected_revision integer, answer_value jsonb, final_submit boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare assignment public.aula_assignments; current_answer public.aula_submissions; deadline timestamptz;
begin
  select * into assignment from aula_assignments where id = assignment_key for share;
  if not found or not exists(select 1 from aula_profiles p join aula_memberships m on m.student_id = p.id
    where p.id = student_key and p.role = 'student' and p.active and not p.must_change_password and m.group_id = assignment.group_id) then
    raise exception 'No tienes acceso a esta actividad' using errcode = '42501';
  end if;
  insert into aula_submissions(assignment_id,student_id,answer,revision) values(assignment_key,student_key,answer_value,0) on conflict do nothing;
  select * into current_answer from aula_submissions where assignment_id = assignment_key and student_id = student_key for update;
  if current_answer.revision <> expected_revision then raise exception 'Hay cambios en otra sesión. Recarga antes de guardar.' using errcode = '40001'; end if;
  if current_answer.submitted_at is not null then raise exception 'La respuesta ya fue entregada' using errcode = '42501'; end if;
  deadline := case when current_answer.returned_at is not null then current_answer.correction_due_at else assignment.due_at end;
  if assignment.closed or (deadline is not null and deadline <= now()) then
    raise exception 'La actividad está cerrada o vencida' using errcode = '42501';
  end if;
  update aula_submissions set answer = answer_value, revision = revision + 1, updated_at = now(), submitted_at = case when final_submit then now() else null end
    where assignment_id = assignment_key and student_id = student_key returning * into current_answer;
  return jsonb_build_object('assignment_id',current_answer.assignment_id,'student_id',current_answer.student_id,
    'revision',current_answer.revision,'updated_at',current_answer.updated_at,'submitted_at',current_answer.submitted_at);
end $$;
revoke all on function public.aula_save_answer(uuid,uuid,integer,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.aula_save_answer(uuid,uuid,integer,jsonb,boolean) to service_role;
commit;
