begin;
-- An expected revision conflict is an HTTP conflict, not a retryable
-- PostgreSQL serialization failure. PostgREST 14 retries 40001 indefinitely.
do $migration$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.aula_save_answer(uuid,uuid,integer,jsonb,boolean)',
    'public.aula_patch_answer(uuid,uuid,integer,jsonb,uuid,boolean)',
    'public.aula_review_answer(uuid,uuid,uuid,integer,text,numeric,text,timestamptz)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('''40001''' in definition) > 0 then
      execute replace(definition, '''40001''', '''PT409''');
    end if;
  end loop;
end $migration$;
commit;
