-- Phase 1 core schema: the money loop.
--
-- Scope note: this migration covers clinics, patients, visits, procedures,
-- medicines, prescriptions, bills, and user_roles -- plus supporting tables
-- that AGENTS.md's own settled decisions require but weren't named as
-- top-level tables. Each is called out below with a one-line reason:
--
--   - visit_procedures    procedures added during consult, before a bill
--                         exists (source for bill_line_items' snapshot).
--   - visit_pricing       AGENTS.md: "visit_pricing carries a monotonic
--                         revision_number." Kept as its own table (not
--                         columns on visits) specifically so "doctor writes
--                         price, receptionist reads only" is one RLS policy
--                         per command, not a trigger inspecting OLD/NEW.
--   - prescription_items  per-drug lines of a prescription (type, strength,
--                         dosage, duration) -- the prescription itself has
--                         no meaning without them.
--   - bill_line_items     AGENTS.md Technical Decision #2: "Procedures ...
--                         foreign-keyed from bill lines." A bill's line
--                         items are a frozen snapshot taken at confirm time
--                         (never re-read from procedures/medicines later),
--                         because non-negotiable #3 makes paid bills
--                         immutable -- a bill can't reference a price that
--                         later moved.
--   - patient_comments    named directly in this request's rule list
--                         ("patient_comments ... readable only by
--                         role=doctor"), so it's included even though it
--                         wasn't in the plain entity list.
--
-- Explicitly deferred (not in this migration):
--   - Stock levels, stock points, purchases/suppliers (phase 2).
--   - Pharma rep check-ins (not named in this request's table list; the
--     token/queue mechanism below only assigns tokens to patient visits).
--   - Prescription templates, custom patient field definitions, long-term
--     patient register (phase 3 / "the long tail" per the PRD's own build
--     order).
--   - Automatic recalculation of visits' calculated_total from procedures
--     + medicines: procedures sum cleanly, but the PRD does not specify how
--     a prescription's dosage/duration maps to a billable medicine quantity
--     or price. Wiring that in with a guessed formula would bake an
--     unverified rule into the hardest layer to change. calculated_total is
--     therefore set by the app (doctor-only, per RLS below) until that
--     formula is defined.
--   - Reports (daily summary, monthly trends, GST) as actual views/RPCs --
--     phase 3 per the PRD's build order. This migration only makes sure
--     admin's RLS posture doesn't foreclose the "aggregate, not row-level"
--     access those reports will need.
--
-- Settled, not built yet: reopening a closed visit. The PRD originally said
-- "doctor or admin"; that's now doctor-only (admin -- the sole maintainer's
-- own account -- is never the right person to correct a bill they weren't
-- present for, and the doctor's {doctor, admin} roles or a locum's
-- role=doctor already cover every real case). What's genuinely unsettled is
-- the mechanism: non-negotiable #3 requires a correction to be a new bill
-- row referencing the original (corrects_bill_id, below), but "reopen"
-- could mean flipping the visit's stage back, or writing a correcting bill
-- and leaving the original visit/bill untouched -- different designs. That
-- gets decided when the billing UI and correction flow are actually being
-- built, not speculatively in this migration. No trigger or RPC for it
-- exists yet; corrects_bill_id is the one piece already settled, since
-- whatever mechanism is chosen will need it.

-- ============================================================
-- Extensions
-- ============================================================

create extension if not exists pg_trgm;

-- ============================================================
-- clinics
--
-- Table only here -- RLS and policies wait until the role-check helpers
-- exist, below, since a policy's USING clause is resolved at CREATE POLICY
-- time and would fail against a function that doesn't exist yet.
-- ============================================================

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  consultation_fee_paise bigint not null default 25000,
  next_token_number bigint not null default 1,
  created_at timestamptz not null default now()
);

-- ============================================================
-- user_roles
--
-- Roles as a set, per clinic, not an enum column on the user -- one human
-- can hold more than one role (the doctor holds {doctor, admin}) without
-- duplicating identities.
--
-- Bootstrapping note: granting the FIRST role for a new clinic can't go
-- through these policies (nobody has admin yet to grant it) -- that step
-- is a service_role/seed action, same as creating the clinic row itself.
--
-- Table only here, same reason as clinics above.
-- ============================================================

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  role text not null check (role in ('doctor', 'receptionist', 'admin')),
  created_at timestamptz not null default now(),
  unique (user_id, clinic_id, role)
);

-- ============================================================
-- Role-check helpers
--
-- SECURITY DEFINER so these can read user_roles regardless of the caller's
-- own RLS visibility into it (otherwise every other table's policies would
-- need to somehow read a table whose own RLS they can't see through, and
-- user_roles' policies would recurse into themselves). search_path is
-- pinned to '' and every reference below is schema-qualified -- an
-- unpinned SECURITY DEFINER function is a privilege-escalation vector.
--
-- These are `language sql`, not plpgsql -- Postgres validates a SQL-
-- language function's body against the catalog at CREATE time, which is
-- exactly why this section has to come after both tables above exist, not
-- before them.
-- ============================================================

create or replace function public.has_clinic_role(p_clinic_id uuid, p_role text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and clinic_id = p_clinic_id
      and role = p_role
  );
$$;

create or replace function public.has_any_clinic_role(p_clinic_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and clinic_id = p_clinic_id
  );
$$;

-- Now that the helpers exist, RLS + policies for clinics and user_roles.

alter table public.clinics enable row level security;

create policy clinics_select on public.clinics
  for select
  using (public.has_any_clinic_role(id));

-- No insert/update/delete policy: creating a clinic (there is exactly one
-- today) is a migration/service_role action, not an authenticated-user one.

alter table public.user_roles enable row level security;

create policy user_roles_select on public.user_roles
  for select
  using (
    user_id = auth.uid()
    or public.has_clinic_role(clinic_id, 'admin')
  );

create policy user_roles_insert on public.user_roles
  for insert
  with check (public.has_clinic_role(clinic_id, 'admin'));

create policy user_roles_update on public.user_roles
  for update
  using (public.has_clinic_role(clinic_id, 'admin'));

create policy user_roles_delete on public.user_roles
  for delete
  using (public.has_clinic_role(clinic_id, 'admin'));

-- ============================================================
-- patients
--
-- Demographic + intake data only. No clinical judgment lives here (the
-- doctor's carried-forward comments are patient_comments, below).
-- ============================================================

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  name text not null,
  age int,
  gender text check (gender in ('Male', 'Female', 'Other')),
  address text,
  phone text check (phone is null or phone ~ '^[0-9]{10}$'),
  height_cm numeric,
  weight_kg numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index patients_clinic_id_idx on public.patients (clinic_id);
create index patients_name_trgm_idx on public.patients using gin (name gin_trgm_ops);
create index patients_phone_idx on public.patients (phone text_pattern_ops);

alter table public.patients enable row level security;

create policy patients_select on public.patients
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create policy patients_insert on public.patients
  for insert
  with check (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create policy patients_update on public.patients
  for update
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

-- ============================================================
-- visits
--
-- token_number is assigned server-side (below), never client-supplied, via
-- an atomic per-clinic counter. arrived_at is supplied by the client at
-- check-in time and is the actual queue sort key -- under the offline
-- mutation queue (non-negotiable #8), created_at is when a row lands in
-- Postgres, which can be well after the patient physically arrived if the
-- receptionist's device was offline. token_number stays the printed label;
-- it is not what "first come, first serve" sorts by.
-- ============================================================

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  patient_id uuid not null references public.patients(id),
  token_number bigint not null,
  arrived_at timestamptz not null,
  stage text not null default 'waiting'
    check (stage in ('waiting', 'with_doctor', 'packing', 'ready_at_reception', 'paid')),
  complaint text not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (clinic_id, token_number)
);

create index visits_clinic_arrived_idx on public.visits (clinic_id, arrived_at);
create index visits_clinic_stage_idx on public.visits (clinic_id, stage);
create index visits_patient_id_idx on public.visits (patient_id);

-- Atomic per-clinic token assignment. A plain "select max(token_number)+1"
-- races under concurrent inserts; this update takes a row lock on the
-- clinic row, serializing assignment. Gaps are fine (a failed insert after
-- the counter bumps just skips a number); reuse or a race is not.
create or replace function public.assign_token_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token bigint;
begin
  update public.clinics
  set next_token_number = next_token_number + 1
  where id = new.clinic_id
  returning next_token_number - 1 into v_token;

  if v_token is null then
    raise exception 'unknown clinic_id %', new.clinic_id;
  end if;

  new.token_number := v_token;
  return new;
end;
$$;

create trigger trg_assign_token_number
  before insert on public.visits
  for each row execute function public.assign_token_number();

-- Every visit gets a matching visit_pricing row (consultation fee only,
-- revision 0) the moment it's created -- the receptionist who checks a
-- patient in has no doctor-only insert grant on visit_pricing, so this has
-- to happen on her behalf.
create or replace function public.create_visit_pricing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee bigint;
begin
  select consultation_fee_paise into v_fee
  from public.clinics
  where id = new.clinic_id;

  insert into public.visit_pricing (clinic_id, visit_id, calculated_total_paise, final_amount_paise, revision_number)
  values (new.clinic_id, new.id, v_fee, v_fee, 0);

  return new;
end;
$$;

alter table public.visits enable row level security;

create policy visits_select on public.visits
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create policy visits_insert on public.visits
  for insert
  with check (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

-- No admin select/update policy on visits -- settled, not deferred (see the
-- file header). Reopening a closed visit is doctor-only, and has no
-- mechanism yet -- there is deliberately no trigger or RPC here to enforce
-- or perform it until the correction flow's actual design is decided.
create policy visits_update on public.visits
  for update
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

-- ============================================================
-- visit_pricing
--
-- Kept separate from visits so "doctor writes price, receptionist reads
-- only" is a plain RLS policy per command instead of a trigger inspecting
-- which columns changed. revision_number is bumped in place, never reused;
-- payment confirmation (bills, below) snapshots it at the moment of
-- confirming.
-- ============================================================

create table public.visit_pricing (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  visit_id uuid not null unique references public.visits(id),
  calculated_total_paise bigint not null check (calculated_total_paise >= 0),
  final_amount_paise bigint not null check (final_amount_paise >= 0),
  discount_paise bigint generated always as (calculated_total_paise - final_amount_paise) stored,
  revision_number bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint final_amount_not_over_total check (final_amount_paise <= calculated_total_paise)
);

create index visit_pricing_clinic_id_idx on public.visit_pricing (clinic_id);

-- Now that visit_pricing exists, the trigger declared above can be attached.
create trigger trg_create_visit_pricing
  after insert on public.visits
  for each row execute function public.create_visit_pricing();

create or replace function public.bump_pricing_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.final_amount_paise is distinct from old.final_amount_paise
     or new.calculated_total_paise is distinct from old.calculated_total_paise then
    new.revision_number := old.revision_number + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_bump_pricing_revision
  before update on public.visit_pricing
  for each row execute function public.bump_pricing_revision();

alter table public.visit_pricing enable row level security;

create policy visit_pricing_select on public.visit_pricing
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

-- Receptionist gets select only -- no insert/update policy for her at all,
-- which is the whole point of splitting this out of visits.
create policy visit_pricing_update on public.visit_pricing
  for update
  using (public.has_clinic_role(clinic_id, 'doctor'));

-- ============================================================
-- procedures
-- ============================================================

create table public.procedures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  name text not null,
  default_price_paise bigint not null check (default_price_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index procedures_clinic_id_idx on public.procedures (clinic_id);

alter table public.procedures enable row level security;

create policy procedures_select on public.procedures
  for select
  using (public.has_any_clinic_role(clinic_id));

create policy procedures_insert on public.procedures
  for insert
  with check (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'admin')
  );

create policy procedures_update on public.procedures
  for update
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'admin')
  );

create policy procedures_delete on public.procedures
  for delete
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'admin')
  );

-- ============================================================
-- medicines
--
-- Catalog only for now. Stock levels are phase 2; wiring dispensed
-- medicines into a bill depends on prescription_items below, which this
-- migration adds, but not on a quantity/price formula the PRD doesn't
-- specify (see the note at the top of this file).
-- ============================================================

create table public.medicines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  name text not null,
  price_paise bigint not null check (price_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index medicines_clinic_id_idx on public.medicines (clinic_id);

alter table public.medicines enable row level security;

create policy medicines_select on public.medicines
  for select
  using (public.has_any_clinic_role(clinic_id));

create policy medicines_insert on public.medicines
  for insert
  with check (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'admin')
  );

create policy medicines_update on public.medicines
  for update
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'admin')
  );

create policy medicines_delete on public.medicines
  for delete
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'admin')
  );

-- ============================================================
-- prescriptions / prescription_items
--
-- Doctor-only read, same as patient_comments: a prescription (drug,
-- dosage, frequency) is clinical content, arguably more sensitive than a
-- comment given this clinic's controlled-substance prescribing. The
-- receptionist's billing view is served entirely by bill_line_items
-- (below), not by reading prescriptions directly.
-- ============================================================

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  visit_id uuid not null references public.visits(id),
  created_at timestamptz not null default now()
);

create index prescriptions_visit_id_idx on public.prescriptions (visit_id);
create index prescriptions_clinic_id_idx on public.prescriptions (clinic_id);

alter table public.prescriptions enable row level security;

create policy prescriptions_select on public.prescriptions
  for select
  using (public.has_clinic_role(clinic_id, 'doctor'));

create policy prescriptions_insert on public.prescriptions
  for insert
  with check (public.has_clinic_role(clinic_id, 'doctor'));

create policy prescriptions_update on public.prescriptions
  for update
  using (public.has_clinic_role(clinic_id, 'doctor'));

create table public.prescription_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  prescription_id uuid not null references public.prescriptions(id),
  medicine_id uuid not null references public.medicines(id),
  drug_type text check (drug_type in ('Tablet', 'Syrup', 'Capsule', 'Powder', 'Injection', 'Other')),
  strength text,
  before_after_food text check (before_after_food in ('Before food', 'After food', 'Either')),
  dosage_frequency text check (dosage_frequency in ('1-0-1', '1-1-1', '0-0-1', '1-0-0', 'SOS', 'Other')),
  duration_days int not null check (duration_days > 0),
  notes text,
  created_at timestamptz not null default now()
);

create index prescription_items_prescription_id_idx on public.prescription_items (prescription_id);

alter table public.prescription_items enable row level security;

create policy prescription_items_select on public.prescription_items
  for select
  using (public.has_clinic_role(clinic_id, 'doctor'));

create policy prescription_items_insert on public.prescription_items
  for insert
  with check (public.has_clinic_role(clinic_id, 'doctor'));

create policy prescription_items_update on public.prescription_items
  for update
  using (public.has_clinic_role(clinic_id, 'doctor'));

create policy prescription_items_delete on public.prescription_items
  for delete
  using (public.has_clinic_role(clinic_id, 'doctor'));

-- ============================================================
-- visit_procedures
--
-- Working data added from the consultation screen, before a bill exists.
-- Doctor-only, same footing as prescriptions -- the receptionist's view is
-- bill_line_items' frozen snapshot, not this table.
-- ============================================================

create table public.visit_procedures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  visit_id uuid not null references public.visits(id),
  procedure_id uuid not null references public.procedures(id),
  price_paise bigint not null check (price_paise >= 0),
  created_at timestamptz not null default now()
);

create index visit_procedures_visit_id_idx on public.visit_procedures (visit_id);

alter table public.visit_procedures enable row level security;

create policy visit_procedures_select on public.visit_procedures
  for select
  using (public.has_clinic_role(clinic_id, 'doctor'));

create policy visit_procedures_insert on public.visit_procedures
  for insert
  with check (public.has_clinic_role(clinic_id, 'doctor'));

create policy visit_procedures_update on public.visit_procedures
  for update
  using (public.has_clinic_role(clinic_id, 'doctor'));

create policy visit_procedures_delete on public.visit_procedures
  for delete
  using (public.has_clinic_role(clinic_id, 'doctor'));

-- ============================================================
-- bills
--
-- Every row is a confirmed bill (non-negotiable #3: paid bills are
-- immutable). final_amount_paise and pricing_revision_at_confirm are the
-- offline-conflict snapshot: what the receptionist's device actually saw
-- and collected against at the moment of confirming, supplied by the app,
-- never recomputed from the live visit_pricing row here -- doing so would
-- silently erase the exact staleness this mechanism exists to detect.
-- corrects_bill_id is the correction mechanism non-negotiable #3 requires:
-- a new row referencing the original, never an UPDATE.
-- ============================================================

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  visit_id uuid not null references public.visits(id),
  final_amount_paise bigint not null check (final_amount_paise >= 0),
  pricing_revision_at_confirm bigint not null,
  payment_method text not null check (payment_method in ('cash', 'upi', 'pay_later')),
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now(),
  corrects_bill_id uuid references public.bills(id)
);

create index bills_visit_id_idx on public.bills (visit_id);
create index bills_clinic_id_idx on public.bills (clinic_id);
create index bills_corrects_bill_id_idx on public.bills (corrects_bill_id);

alter table public.bills enable row level security;

create policy bills_select on public.bills
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create policy bills_insert on public.bills
  for insert
  with check (public.has_clinic_role(clinic_id, 'receptionist'));

-- No update/delete policy anywhere on bills -- immutability is enforced by
-- omission, not a trigger. A correction is a new row.

-- Derived, not stored: a stored "needs_reconciliation" flag set at insert
-- only catches one ordering of the offline race (the doctor's revision
-- syncing before the payment). If the bill syncs first, revisions match at
-- insert time and a stored flag would never fire even though a
-- contradicting revision arrives moments later -- and there's no way to
-- flip it afterwards on an immutable row. Comparing live against the
-- current visit_pricing catches both orderings, and "not exists a
-- correction" is what the existing correction mechanism already clears it
-- with -- no separate resolution step needed. security_invoker so the view
-- enforces the querying user's RLS on bills/visit_pricing, not the view
-- owner's.
create view public.bills_needing_reconciliation
  with (security_invoker = true)
  as
  select b.*
  from public.bills b
  join public.visit_pricing vp on vp.visit_id = b.visit_id
  where b.pricing_revision_at_confirm <> vp.revision_number
    and not exists (
      select 1 from public.bills c where c.corrects_bill_id = b.id
    );

-- ============================================================
-- bill_line_items
--
-- Frozen snapshot at confirm time -- see the file header. description is
-- the item's name at the moment of billing, independent of whether the
-- underlying procedure/medicine is later renamed.
-- ============================================================

create table public.bill_line_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  bill_id uuid not null references public.bills(id),
  kind text not null check (kind in ('consultation', 'procedure', 'medicine')),
  procedure_id uuid references public.procedures(id),
  medicine_id uuid references public.medicines(id),
  description text not null,
  quantity int not null default 1 check (quantity > 0),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  line_total_paise bigint generated always as (quantity * unit_price_paise) stored,
  constraint bill_line_items_kind_fk_consistency check (
    (kind = 'procedure' and procedure_id is not null and medicine_id is null)
    or (kind = 'medicine' and medicine_id is not null and procedure_id is null)
    or (kind = 'consultation' and procedure_id is null and medicine_id is null)
  )
);

create index bill_line_items_bill_id_idx on public.bill_line_items (bill_id);

alter table public.bill_line_items enable row level security;

create policy bill_line_items_select on public.bill_line_items
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create policy bill_line_items_insert on public.bill_line_items
  for insert
  with check (public.has_clinic_role(clinic_id, 'receptionist'));

-- No update/delete -- same immutability posture as bills.

-- ============================================================
-- patient_comments
--
-- The doctor's carried-forward working notes, per AGENTS.md's rule:
-- readable only by role=doctor, enforced here at the RLS layer rather than
-- left to which screen happens to query which columns. Admin (including
-- the sole maintainer's admin-only account) has no access.
-- ============================================================

create table public.patient_comments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  patient_id uuid not null references public.patients(id),
  author_id uuid not null references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

create index patient_comments_patient_id_idx on public.patient_comments (patient_id);

alter table public.patient_comments enable row level security;

create policy patient_comments_select on public.patient_comments
  for select
  using (public.has_clinic_role(clinic_id, 'doctor'));

create policy patient_comments_insert on public.patient_comments
  for insert
  with check (public.has_clinic_role(clinic_id, 'doctor'));

create policy patient_comments_update on public.patient_comments
  for update
  using (public.has_clinic_role(clinic_id, 'doctor'));

create policy patient_comments_delete on public.patient_comments
  for delete
  using (public.has_clinic_role(clinic_id, 'doctor'));

-- ============================================================
-- Function grants
--
-- EXECUTE on the two role-check helpers is needed by every policy above
-- (they run as the querying user's privileges for this purpose, security
-- definer only elevates their internal read of user_roles).
-- ============================================================

grant execute on function public.has_clinic_role(uuid, text) to authenticated;
grant execute on function public.has_any_clinic_role(uuid) to authenticated;
