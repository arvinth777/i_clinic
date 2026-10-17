-- ONE-OFF: clears the test data from PRODUCTION (written 2026-10-18 after a read-only look at what is there:
-- 2 patients, 2 visits, 1 bill, 1 prescription, 1 medicine "pyroxim", 5 queue events, 2 document archives).
--
-- KEEPS: the clinic, logins and roles (user_roles), stock points (Counter, Storeroom), the Google Drive connection,
--        procedures, prescription templates and custom patient fields.
-- DELETES: patients, visits and everything hanging off them (prescriptions, bills, payments, queue history, document
--          archives, uploaded patient files), refills, pharma rep check-ins, the medicine list and its stock, suppliers,
--          purchases and stock counts. Token numbers start again from the beginning.
--
-- HOW TO RUN (Supabase dashboard, project clinic-prod, SQL editor): paste the whole file and press Run.
-- As written it ends with ROLLBACK, so the first run is a DRY RUN: it shows the "before" counts and the "after" counts
-- (the after counts are what you would be left with) and changes nothing. If they look right, change the last line
-- from  rollback;  to  commit;  and run again.
--
-- SAFETY: it refuses to run unless this really is the production clinic and the only patients are the two test ones,
-- so it cannot wipe real patient data if it is ever run again later.

begin;

do $$
declare unexpected int; clinic_name text;
begin
  select name into clinic_name from public.clinics limit 1;
  if clinic_name is distinct from 'Salem Pain & Palliative Care Clinic' then
    raise exception 'Refusing to run: this is not the production clinic (found %)', clinic_name;
  end if;
  select count(*) into unexpected from public.patients
    where name not in ('kirupa', 'ZZ TEST height-weight release check (delete)');
  if unexpected > 0 then
    raise exception 'Refusing to run: % patient(s) are not the known test patients', unexpected;
  end if;
end $$;

select 'before' as step, (select count(*) from public.patients) as patients, (select count(*) from public.visits) as visits,
  (select count(*) from public.bills) as bills, (select count(*) from public.prescriptions) as prescriptions,
  (select count(*) from public.medicines) as medicines, (select count(*) from public.queue_events) as queue_events,
  (select count(*) from public.document_archives) as archives, (select count(*) from public.user_roles) as logins,
  (select count(*) from public.stock_points) as stock_points;

truncate table
  public.patients, public.visits, public.pharmacy_sales, public.pharmacy_sale_items, public.pharma_rep_checkins,
  public.medicines, public.suppliers, public.purchases, public.purchase_items, public.stock_counts, public.stock_count_lines,
  public.stock_movements, public.bills, public.bill_line_items, public.bill_settlements, public.patient_files,
  public.duplicate_dismissals, public.document_archives, public.queue_events, public.clinic_documents
  restart identity cascade;

select 'after' as step, (select count(*) from public.patients) as patients, (select count(*) from public.visits) as visits,
  (select count(*) from public.bills) as bills, (select count(*) from public.prescriptions) as prescriptions,
  (select count(*) from public.medicines) as medicines, (select count(*) from public.queue_events) as queue_events,
  (select count(*) from public.document_archives) as archives, (select count(*) from public.user_roles) as logins,
  (select count(*) from public.stock_points) as stock_points;

rollback;  -- change to: commit;   after checking the numbers above
