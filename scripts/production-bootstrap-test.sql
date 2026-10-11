-- Run only on an isolated PostgreSQL 17 database named clinic_bootstrap_test.
-- Platform role/auth/publication stubs must exist before applying the bootstrap.
begin;
do $$
begin
 if current_database()<>'clinic_bootstrap_test' then raise exception 'Local bootstrap test database required'; end if;
 assert (select count(*) from pg_tables where schemaname='public')=32,'all app tables created';
 assert not exists(select 1 from pg_tables where schemaname='public' and not rowsecurity),'RLS on every table';
 assert (select count(*) from public.clinics)=1,'retry must not duplicate clinic';
 assert (select consultation_fee_paise from public.clinics)=25000,'consultation stays integer paise';
 assert (select count(*) from public.stock_points)=2,'Counter and Storeroom initialized';
 assert not exists(select 1 from public.patients),'no staging patients copied';
 assert not exists(select 1 from public.medicines),'no staging catalog copied';
 assert not exists(select 1 from public.user_roles),'no staging identities copied';
 assert (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public')=4,'realtime membership preserved';
 assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.proname not in ('health_ping','rls_auto_enable') and has_function_privilege('anon',p.oid,'EXECUTE')),'restricted RPCs cannot inherit anonymous execution';
 assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.proname<>'rls_auto_enable' and not ('search_path=""'=any(p.proconfig))),'definer search paths pinned';
 assert has_function_privilege('authenticated','public.queue_visit_action(uuid,text,uuid,text,timestamp with time zone)','EXECUTE'),'staff queue callable';
 assert has_function_privilege('authenticated','public.confirm_bill(uuid,text,bigint,bigint,jsonb)','EXECUTE'),'staff payment callable';
end $$;
set local role anon;
do $$ begin
 begin
  assert not exists(select 1 from public.patients),'anonymous patient isolation';
 exception when insufficient_privilege then null;
 end;
end $$;
rollback;
