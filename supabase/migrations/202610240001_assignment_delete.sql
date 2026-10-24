begin;
-- Borrar una asignación elimina sus respuestas y el historial asociado en una transacción.
alter table public.aula_submissions drop constraint aula_submissions_assignment_id_fkey;
alter table public.aula_submissions add constraint aula_submissions_assignment_id_fkey
  foreign key (assignment_id) references public.aula_assignments(id) on delete cascade;
alter table public.aula_reviews drop constraint aula_reviews_assignment_id_student_id_fkey;
alter table public.aula_reviews add constraint aula_reviews_assignment_id_student_id_fkey
  foreign key (assignment_id, student_id) references public.aula_submissions(assignment_id, student_id) on delete cascade;
commit;
