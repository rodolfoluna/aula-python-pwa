-- Reparación para proyectos que ya ejecutaron 202610170001_accounts.sql.
-- No elimina usuarios ni cambia contraseñas, roles o perfiles existentes.
begin;
create or replace function public.aula_provision_profile() returns trigger
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
drop trigger if exists aula_new_auth_user on auth.users;
create trigger aula_new_auth_user after insert or update of raw_app_meta_data on auth.users
for each row execute function public.aula_provision_profile();
revoke all on function public.aula_provision_profile() from public;

-- Recuperar solo profesores cuyo rol proviene de metadatos administrativos.
insert into public.aula_profiles(id, role, name, must_change_password)
select id, 'teacher', raw_app_meta_data->>'aula_name', false
from auth.users where raw_app_meta_data->>'aula_role' = 'teacher'
  and length(trim(raw_app_meta_data->>'aula_name')) between 1 and 160
on conflict (id) do nothing;
commit;
