-- Phase D (docs/build-plan.md): documents, long-term register, follow-up
-- dates, pharma rep check-in. Four self-contained additions, one migration.
--
-- ============================================================
-- clinics: doctor_name / doctor_registration_number
--
-- Certificates/sick-leave/referral letters print these in a signature
-- footer. Same idiom as upi_vpa (20260906140000): clinics has no client
-- update policy at all, so a narrow admin-gated RPC, not a blanket
-- UPDATE policy that would also expose next_token_number.
-- ============================================================

alter table public.clinics
  add column doctor_name text,
  add column doctor_registration_number text;

create or replace function public.admin_set_clinic_doctor_info(p_clinic_id uuid, p_doctor_name text, p_doctor_registration_number text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_clinic_role(p_clinic_id, 'admin') then
    raise exception 'only admin can configure the clinic doctor info';
  end if;

  update public.clinics
  set doctor_name = nullif(trim(p_doctor_name), ''),
      doctor_registration_number = nullif(trim(p_doctor_registration_number), '')
  where id = p_clinic_id;
end;
$$;

revoke execute on function public.admin_set_clinic_doctor_info(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_clinic_doctor_info(uuid, text, text) to authenticated;

-- ============================================================
-- patients: long-term register flag
--
-- "Doctor flags a patient long-term with a review interval" (PRD) is a
-- named, doctor-exclusive decision -- same weight as "doctor sets the
-- final amount." patients_update already grants both doctor and
-- receptionist a blanket UPDATE (needed for other columns), so a plain
-- RPC role-check alone would be documentation, not enforcement: a
-- receptionist could still call `.from('patients').update(...)` directly
-- under that existing policy. A BEFORE UPDATE trigger closes that gap
-- for these two specific columns regardless of which path (RPC or a
-- direct client call) reaches the row. next_review_due is deliberately
-- NOT covered by the guard -- it must also be settable by the automatic
-- new-visit reset below, which runs under whichever role (often
-- receptionist, at check-in) triggered the insert.
-- ============================================================

alter table public.patients
  add column is_long_term boolean not null default false,
  add column long_term_review_interval_days int,
  add column next_review_due date,
  add constraint patients_long_term_shape check (
    (is_long_term = false and long_term_review_interval_days is null and next_review_due is null)
    or (is_long_term = true and long_term_review_interval_days > 0)
  );

create or replace function public.enforce_patient_long_term_authorship()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.is_long_term is distinct from old.is_long_term
      or new.long_term_review_interval_days is distinct from old.long_term_review_interval_days)
     and not public.has_clinic_role(new.clinic_id, 'doctor') then
    raise exception 'only a doctor can flag a patient long-term';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_patient_long_term_authorship
  before update on public.patients
  for each row execute function public.enforce_patient_long_term_authorship();

revoke execute on function public.enforce_patient_long_term_authorship() from public, anon, authenticated;

create or replace function public.set_patient_long_term(p_patient_id uuid, p_is_long_term boolean, p_review_interval_days int default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_last_visit date;
begin
  select clinic_id into v_clinic_id from public.patients where id = p_patient_id;

  if v_clinic_id is null then
    raise exception 'unknown patient %', p_patient_id;
  end if;

  if not public.has_clinic_role(v_clinic_id, 'doctor') then
    raise exception 'only a doctor can flag a patient long-term';
  end if;

  if p_is_long_term then
    if p_review_interval_days is null or p_review_interval_days <= 0 then
      raise exception 'review interval must be a positive number of days';
    end if;

    select max(arrived_at)::date into v_last_visit
    from public.visits
    where patient_id = p_patient_id;

    update public.patients
    set is_long_term = true,
        long_term_review_interval_days = p_review_interval_days,
        next_review_due = coalesce(v_last_visit, current_date) + p_review_interval_days
    where id = p_patient_id;
  else
    update public.patients
    set is_long_term = false,
        long_term_review_interval_days = null,
        next_review_due = null
    where id = p_patient_id;
  end if;
end;
$$;

revoke execute on function public.set_patient_long_term(uuid, boolean, int) from public, anon, authenticated;
grant execute on function public.set_patient_long_term(uuid, boolean, int) to authenticated;

-- "A new visit resets the next review date automatically" (PRD) -- fires
-- for every visit insert regardless of who checked the patient in;
-- no-ops silently unless the patient is actually flagged long-term with
-- an interval set (guarded explicitly, not just implied by the shape
-- constraint, so a flagged-but-interval-null edge case degrades to a
-- no-op here rather than surfacing as a failed check-in later).
create or replace function public.reset_long_term_review_on_visit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_long_term boolean;
  v_interval int;
begin
  select is_long_term, long_term_review_interval_days into v_is_long_term, v_interval
  from public.patients
  where id = new.patient_id;

  if v_is_long_term and v_interval is not null then
    update public.patients
    set next_review_due = new.arrived_at::date + v_interval
    where id = new.patient_id;
  end if;

  return new;
end;
$$;

create trigger trg_reset_long_term_review_on_visit
  after insert on public.visits
  for each row execute function public.reset_long_term_review_on_visit();

revoke execute on function public.reset_long_term_review_on_visit() from public, anon, authenticated;

-- security_invoker so this inherits the querying user's own RLS on
-- patients (doctor + receptionist only, per patients_select -- admin
-- gets nothing, same as every other patient-data surface). Ordering is
-- left to the caller (`order by next_review_due asc` gives "most
-- overdue first"); a view's own ORDER BY isn't guaranteed to survive
-- further query composition, so it isn't relied on here.
create view public.long_term_register
  with (security_invoker = true)
  as
  select
    p.id as patient_id,
    p.clinic_id,
    p.name,
    p.long_term_review_interval_days,
    p.next_review_due,
    (select max(v.arrived_at) from public.visits v where v.patient_id = p.id) as last_visit_at
  from public.patients p
  where p.is_long_term = true;

-- ============================================================
-- visits: follow-up date
--
-- "The doctor sets one on the consultation screen" / "surfaces to
-- reception as a to-do on the due date" (PRD) -- two different roles
-- each own one column. Same enforcement gap as patients above
-- (visits_update already grants both roles a blanket UPDATE), closed the
-- same way: a BEFORE UPDATE trigger checked per-column, not per-row.
-- ============================================================

alter table public.visits
  add column follow_up_date date,
  add column follow_up_done_at timestamptz,
  add constraint visits_follow_up_done_requires_date check (follow_up_done_at is null or follow_up_date is not null);

create or replace function public.enforce_visit_followup_authorship()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.follow_up_date is distinct from old.follow_up_date
     and not public.has_clinic_role(new.clinic_id, 'doctor') then
    raise exception 'only a doctor can set a visit follow-up date';
  end if;

  if new.follow_up_done_at is distinct from old.follow_up_done_at
     and not public.has_clinic_role(new.clinic_id, 'receptionist') then
    raise exception 'only reception can mark a follow-up done';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_visit_followup_authorship
  before update on public.visits
  for each row execute function public.enforce_visit_followup_authorship();

revoke execute on function public.enforce_visit_followup_authorship() from public, anon, authenticated;

create or replace function public.set_visit_follow_up(p_visit_id uuid, p_follow_up_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.visits where id = p_visit_id;

  if v_clinic_id is null then
    raise exception 'unknown visit %', p_visit_id;
  end if;

  if not public.has_clinic_role(v_clinic_id, 'doctor') then
    raise exception 'only a doctor can set a visit follow-up date';
  end if;

  -- A revised date starts a fresh to-do -- any earlier "done" mark no
  -- longer applies to it.
  update public.visits
  set follow_up_date = p_follow_up_date, follow_up_done_at = null
  where id = p_visit_id;
end;
$$;

revoke execute on function public.set_visit_follow_up(uuid, date) from public, anon, authenticated;
grant execute on function public.set_visit_follow_up(uuid, date) to authenticated;

create or replace function public.mark_follow_up_done(p_visit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.visits where id = p_visit_id;

  if v_clinic_id is null then
    raise exception 'unknown visit %', p_visit_id;
  end if;

  if not public.has_clinic_role(v_clinic_id, 'receptionist') then
    raise exception 'only reception can mark a follow-up done';
  end if;

  update public.visits
  set follow_up_done_at = now()
  where id = p_visit_id;
end;
$$;

revoke execute on function public.mark_follow_up_done(uuid) from public, anon, authenticated;
grant execute on function public.mark_follow_up_done(uuid) to authenticated;

-- ============================================================
-- clinic_documents
--
-- Certificate / sick-leave / referral, issued from the consultation
-- screen, attached to the visit. Doctor-only select+insert -- same
-- reasoning as prescriptions (a referral's case summary or a sick-leave
-- reason is clinical free text, arguably as sensitive as a prescription
-- or a patient comment); the receptionist's job never needs to read
-- these, only to receive the printed paper the doctor hands over, which
-- needs no read access at all. No update/delete policy: an issued
-- document is a fixed, append-only record of what was actually printed,
-- same posture as bill_settlements/stock_movements.
-- ============================================================

create table public.clinic_documents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  visit_id uuid not null references public.visits(id),
  document_type text not null check (document_type in ('certificate', 'sick_leave', 'referral')),
  purpose text,
  rest_from date,
  rest_to date,
  reason text,
  referred_to text,
  case_summary text,
  issued_by uuid not null references auth.users(id),
  issued_at timestamptz not null default now(),
  constraint clinic_documents_shape check (
    (document_type = 'certificate' and purpose is not null)
    or (document_type = 'sick_leave' and rest_from is not null and rest_to is not null and reason is not null)
    or (document_type = 'referral' and referred_to is not null and reason is not null)
  ),
  constraint clinic_documents_rest_period_order check (rest_to is null or rest_from is null or rest_to >= rest_from)
);

create index clinic_documents_clinic_id_idx on public.clinic_documents (clinic_id);
create index clinic_documents_visit_id_idx on public.clinic_documents (visit_id);

alter table public.clinic_documents enable row level security;

create policy clinic_documents_select on public.clinic_documents
  for select
  using (public.has_clinic_role(clinic_id, 'doctor'));

create policy clinic_documents_insert on public.clinic_documents
  for insert
  with check (public.has_clinic_role(clinic_id, 'doctor'));

-- ============================================================
-- pharma_rep_checkins
--
-- "Name and Company only. No medical record, no bill" (PRD) -- a table
-- of its own, not a visits row: visits.stage's check constraint has no
-- "rep" state, and a rep was never meant to acquire a token, a
-- patient_id, or any of visits' clinical/billing columns. Checked in by
-- reception (PRD: "the receptionist checks them in"); marked done from
-- the doctor's queue, where reps are actually displayed.
-- ============================================================

create table public.pharma_rep_checkins (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  rep_name text not null,
  company text not null,
  arrived_at timestamptz not null default now(),
  done_at timestamptz,
  checked_in_by uuid not null references auth.users(id)
);

create index pharma_rep_checkins_clinic_id_idx on public.pharma_rep_checkins (clinic_id);

alter table public.pharma_rep_checkins enable row level security;

create policy pharma_rep_checkins_select on public.pharma_rep_checkins
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create policy pharma_rep_checkins_insert on public.pharma_rep_checkins
  for insert
  with check (public.has_clinic_role(clinic_id, 'receptionist'));

create policy pharma_rep_checkins_update on public.pharma_rep_checkins
  for update
  using (public.has_clinic_role(clinic_id, 'doctor'));

-- ============================================================
-- Deferred seed case (per AGENTS.md: rides with the migration that adds
-- the table it needs): a rep queued behind a later-arriving patient.
-- The rep's arrived_at is set two hours before the patient's, relative
-- to migration-apply time -- the doctor's queue must still show the
-- patient first, per PRD "reps always sit behind every waiting patient,
-- including later arrivals." This is the case that a naive single-
-- column sort (by arrived_at, or by token_number with reps defaulted to
-- some fake token) would get backwards.
-- ============================================================

do $$
declare
  v_clinic_id uuid;
  v_patient_id uuid;
  v_receptionist_id uuid;
begin
  select id into v_clinic_id from public.clinics where name = 'Clinic A (staging seed)';
  select u.id into v_receptionist_id
  from auth.users u
  join public.user_roles ur on ur.user_id = u.id
  where ur.clinic_id = v_clinic_id and ur.role = 'receptionist'
  limit 1;

  if v_clinic_id is null or v_receptionist_id is null then
    raise exception 'seed prerequisites missing: clinic=%, receptionist=%', v_clinic_id, v_receptionist_id;
  end if;

  insert into public.patients (clinic_id, name, age)
  values (v_clinic_id, 'Seed Rep Sort Test Patient', 40)
  returning id into v_patient_id;

  insert into public.pharma_rep_checkins (clinic_id, rep_name, company, arrived_at, checked_in_by)
  values (v_clinic_id, 'Seed Test Rep', 'Seed Pharma Co', now() - interval '2 hours', v_receptionist_id);

  insert into public.visits (clinic_id, patient_id, arrived_at, complaint, stage)
  values (v_clinic_id, v_patient_id, now() - interval '30 minutes', 'seed: rep sort test', 'waiting');
end $$;
