-- The weekly pg_dump connects as backup_reader (SELECT grants only, no BYPASSRLS: a hosted Supabase project cannot
-- give another role BYPASSRLS). Every public table has RLS on and no policy named this role, so the dump saw zero
-- rows. Give backup_reader a read-only policy on every existing public table; scripts/backup.sh now fails loudly
-- when a table is missing one (a new table needs the same policy: see docs/runbook.md "Backups").
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename and p.policyname = 'backup_reader_read') then
      execute format('create policy backup_reader_read on public.%I for select to backup_reader using (true)', t.tablename);
    end if;
  end loop;
end $$;
