-- Ejecutar una vez en SQL Editor del proyecto Supabase.
begin;

create table public.aula_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('teacher', 'student')),
  teacher_id uuid references public.aula_profiles(id),
  control text unique check (control ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name text not null check (length(trim(name)) between 1 and 160),
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  check ((role = 'teacher' and teacher_id is null and control is null)
    or (role = 'student' and teacher_id is not null and control is not null))
);
create index aula_profiles_teacher_idx on public.aula_profiles(teacher_id);

create table public.aula_groups (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.aula_profiles(id),
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (teacher_id, name)
);
create table public.aula_memberships (
  group_id uuid not null references public.aula_groups(id) on delete cascade,
  student_id uuid not null references public.aula_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, student_id)
);
create index aula_memberships_student_idx on public.aula_memberships(student_id);

create function public.aula_validate_membership() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.aula_groups g join public.aula_profiles s
    on s.teacher_id = g.teacher_id where g.id = new.group_id
    and s.id = new.student_id and s.role = 'student') then
    raise exception 'El alumno y el grupo deben pertenecer al mismo profesor';
  end if;
  return new;
end $$;
create trigger aula_membership_owner before insert or update on public.aula_memberships
for each row execute function public.aula_validate_membership();
revoke all on function public.aula_validate_membership() from public;

-- Solo app_metadata, que únicamente modifica el administrador de Auth.
-- user_metadata, controlado por el usuario, nunca concede un rol.
create function public.aula_provision_profile() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare kind text := new.raw_app_meta_data->>'aula_role'; owner_id uuid;
begin
  if kind not in ('teacher', 'student') or kind is null then return new; end if;
  if kind = 'student' then
    owner_id := (new.raw_app_meta_data->>'aula_teacher_id')::uuid;
    if not exists (select 1 from public.aula_profiles where id = owner_id and role = 'teacher' and active) then
      raise exception 'El profesor no existe o está inactivo';
    end if;
  end if;
  insert into public.aula_profiles(id, role, teacher_id, control, name, must_change_password)
  values (new.id, kind, owner_id,
    case when kind = 'student' then upper(new.raw_app_meta_data->>'aula_control') else null end,
    new.raw_app_meta_data->>'aula_name', kind = 'student')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger aula_new_auth_user after insert or update of raw_app_meta_data on auth.users
for each row execute function public.aula_provision_profile();
revoke all on function public.aula_provision_profile() from public;

create function public.aula_is_teacher() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.aula_profiles where id = auth.uid()
    and role = 'teacher' and active and not must_change_password);
$$;
create function public.aula_ready_student() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.aula_profiles where id = auth.uid()
    and role = 'student' and active and not must_change_password);
$$;
create function public.aula_owns_group(group_key uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.aula_groups where id = group_key and teacher_id = auth.uid());
$$;
create function public.aula_in_group(group_key uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.aula_memberships where group_id = group_key and student_id = auth.uid());
$$;
revoke all on function public.aula_is_teacher() from public;
revoke all on function public.aula_ready_student() from public;
grant execute on function public.aula_is_teacher(), public.aula_ready_student() to authenticated;
revoke all on function public.aula_owns_group(uuid), public.aula_in_group(uuid) from public;
grant execute on function public.aula_owns_group(uuid), public.aula_in_group(uuid) to authenticated;

-- Aunque el backend compruebe permisos, el acceso directo también está limitado.
alter table public.aula_profiles enable row level security;
alter table public.aula_groups enable row level security;
alter table public.aula_memberships enable row level security;
revoke all on public.aula_profiles, public.aula_groups, public.aula_memberships from anon, authenticated;
grant select on public.aula_profiles, public.aula_groups, public.aula_memberships to authenticated;
grant all on public.aula_profiles, public.aula_groups, public.aula_memberships to service_role;

create policy aula_profiles_read on public.aula_profiles for select to authenticated using (
  (id = auth.uid() and active) or (teacher_id = auth.uid() and public.aula_is_teacher())
);
create policy aula_groups_read on public.aula_groups for select to authenticated using (
  (teacher_id = auth.uid() and public.aula_is_teacher()) or
  (public.aula_ready_student() and public.aula_in_group(id))
);
-- No consulta aula_groups para el caso alumno: evita recursión entre políticas.
create policy aula_memberships_read on public.aula_memberships for select to authenticated using (
  (student_id = auth.uid() and public.aula_ready_student()) or
  (public.aula_is_teacher() and public.aula_owns_group(group_id))
);
commit;
