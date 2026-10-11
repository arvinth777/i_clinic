-- Isolated local bootstrap only; roll back publication changes after verification.
begin;
do $$ begin
  if current_database() <> 'clinic_bootstrap_test' then raise exception 'Local bootstrap test database required'; end if;
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
\ir ../supabase/migrations/20261011200000_rep_queue_realtime.sql
\ir ../supabase/migrations/20261011200000_rep_queue_realtime.sql
do $$ begin
 assert (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('queue_events','pharma_rep_checkins'))=2, 'both publications added exactly once';
 assert not exists(select 1 from pg_class where relname in ('queue_events','pharma_rep_checkins') and not relrowsecurity), 'RLS remains enabled';
end $$;
rollback;
