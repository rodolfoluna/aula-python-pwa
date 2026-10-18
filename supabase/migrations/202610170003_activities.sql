begin;
create table public.aula_activities (
  id uuid primary key default gen_random_uuid(), teacher_id uuid not null references public.aula_profiles(id),
  title text not null check (length(trim(title)) between 1 and 160), kind text not null check (kind in ('notebook','files')),
  instructions text not null default '', content jsonb not null, version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (octet_length(content::text) <= 600000)
);
create index aula_activities_teacher_idx on public.aula_activities(teacher_id);
create table public.aula_assignments (
  id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.aula_activities(id),
  teacher_id uuid not null references public.aula_profiles(id), group_id uuid not null references public.aula_groups(id),
  activity_version integer not null, snapshot jsonb not null, due_at timestamptz, closed boolean not null default false,
  created_at timestamptz not null default now(), unique(activity_id, group_id, activity_version)
);
create index aula_assignments_group_idx on public.aula_assignments(group_id);
create index aula_assignments_teacher_idx on public.aula_assignments(teacher_id);
create table public.aula_submissions (
  assignment_id uuid not null references public.aula_assignments(id), student_id uuid not null references public.aula_profiles(id),
  answer jsonb not null, revision integer not null default 0, updated_at timestamptz not null default now(), submitted_at timestamptz,
  primary key(assignment_id, student_id), check(octet_length(answer::text) <= 600000)
);
create index aula_submissions_student_idx on public.aula_submissions(student_id);

create function public.aula_assignment_guard() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists(select 1 from aula_activities a join aula_groups g on g.teacher_id = a.teacher_id
    where a.id = new.activity_id and g.id = new.group_id and a.teacher_id = new.teacher_id) then
    raise exception 'La actividad y el grupo deben pertenecer al profesor';
  end if;
  if tg_op = 'UPDATE' and (new.snapshot is distinct from old.snapshot or new.activity_version <> old.activity_version
    or new.group_id <> old.group_id or new.activity_id <> old.activity_id or new.teacher_id <> old.teacher_id) then
    raise exception 'Una asignación publicada no se puede modificar';
  end if;
  return new;
end $$;
create trigger aula_assignment_guard before insert or update on public.aula_assignments
for each row execute function public.aula_assignment_guard();
revoke all on function public.aula_assignment_guard() from public;

create function public.aula_can_read_assignment(key uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from aula_assignments a where a.id = key and
    ((a.teacher_id = auth.uid() and aula_is_teacher()) or (aula_ready_student() and aula_in_group(a.group_id))));
$$;
revoke all on function public.aula_can_read_assignment(uuid) from public;
grant execute on function public.aula_can_read_assignment(uuid) to authenticated;
alter table public.aula_activities enable row level security;
alter table public.aula_assignments enable row level security;
alter table public.aula_submissions enable row level security;
revoke all on public.aula_activities, public.aula_assignments, public.aula_submissions from anon, authenticated;
grant select on public.aula_activities, public.aula_assignments, public.aula_submissions to authenticated;
grant all on public.aula_activities, public.aula_assignments, public.aula_submissions to service_role;
create policy aula_activities_read on public.aula_activities for select to authenticated using(teacher_id = auth.uid() and aula_is_teacher());
create policy aula_assignments_read on public.aula_assignments for select to authenticated using(aula_can_read_assignment(id));
create policy aula_submissions_read on public.aula_submissions for select to authenticated using(
  (student_id = auth.uid() and aula_ready_student() and aula_can_read_assignment(assignment_id)) or
  (aula_is_teacher() and exists(select 1 from aula_assignments a where a.id = assignment_id and a.teacher_id = auth.uid()))
);

-- Solo el backend puede escribir respuestas: primero valida las celdas y archivos.
-- La revisión y el estado de entrega se comprueban de forma atómica en PostgreSQL.
create function public.aula_save_answer(assignment_key uuid, student_key uuid, expected_revision integer, answer_value jsonb, final_submit boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare assignment public.aula_assignments; current_answer public.aula_submissions;
begin
  select * into assignment from aula_assignments where id = assignment_key for share;
  if not found or not exists(select 1 from aula_profiles p join aula_memberships m on m.student_id = p.id
    where p.id = student_key and p.role = 'student' and p.active and not p.must_change_password and m.group_id = assignment.group_id) then
    raise exception 'No tienes acceso a esta actividad' using errcode = '42501';
  end if;
  if assignment.closed or (assignment.due_at is not null and assignment.due_at <= now()) then
    raise exception 'La actividad está cerrada o vencida' using errcode = '42501';
  end if;
  insert into aula_submissions(assignment_id,student_id,answer,revision) values(assignment_key,student_key,answer_value,0) on conflict do nothing;
  select * into current_answer from aula_submissions where assignment_id = assignment_key and student_id = student_key for update;
  if current_answer.revision <> expected_revision then raise exception 'Hay cambios en otra sesión. Recarga antes de guardar.' using errcode = '40001'; end if;
  if current_answer.submitted_at is not null then raise exception 'La respuesta ya fue entregada' using errcode = '42501'; end if;
  update aula_submissions set answer = answer_value, revision = revision + 1, updated_at = now(), submitted_at = case when final_submit then now() else null end
    where assignment_id = assignment_key and student_id = student_key returning * into current_answer;
  -- El cliente ya tiene su código: devolver solo el acuse ahorra transferencia.
  return jsonb_build_object('assignment_id', current_answer.assignment_id, 'student_id', current_answer.student_id,
    'revision', current_answer.revision, 'updated_at', current_answer.updated_at, 'submitted_at', current_answer.submitted_at);
end $$;
revoke all on function public.aula_save_answer(uuid,uuid,integer,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.aula_save_answer(uuid,uuid,integer,jsonb,boolean) to service_role;
commit;
