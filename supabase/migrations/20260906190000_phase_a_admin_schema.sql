-- Phase A (docs/build-plan.md): schema for the Admin screen.
-- RLS on medicines/procedures already granted admin full CRUD when they
-- were first created (has_clinic_role(clinic_id,'doctor') OR
-- has_clinic_role(clinic_id,'admin')) -- confirmed directly via
-- pg_policies before writing this migration, not assumed. Nothing to
-- change there; this migration adds the columns/tables/policies that
-- were genuinely missing.

-- ============================================================
-- Drug list fields the PRD's Admin/Settings screen names but the
-- schema never carried: type, strength options, low-stock threshold,
-- expiry date. All nullable -- every medicine that exists today
-- (including ad-hoc ones added from the consultation screen) predates
-- these and must keep working with them unset.
-- ============================================================
alter table public.medicines
  add column drug_type text check (drug_type is null or drug_type in ('Tablet', 'Syrup', 'Capsule', 'Powder', 'Injection', 'Other')),
  add column strength_options text[],
  add column low_stock_threshold integer check (low_stock_threshold is null or low_stock_threshold >= 0),
  add column expiry_date date;

-- ============================================================
-- Custom patient fields (AGENTS.md Technical Decision #2): definitions
-- in a real table so Admin can render/validate/order them and rename a
-- field without rewriting every row; values in a JSONB column on the
-- patient, keyed by patient_field_definitions.key. Adding a field is an
-- INSERT into patient_field_definitions -- never a migration.
-- ============================================================
alter table public.patients
  add column custom_fields jsonb not null default '{}'::jsonb;

create table public.patient_field_definitions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  key text not null,
  label text not null,
  field_type text not null check (field_type in ('text', 'number', 'date', 'boolean')),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (clinic_id, key)
);

alter table public.patient_field_definitions enable row level security;

-- Doctor and reception both need to read these to render the field on
-- the intake/consultation screen -- same read footing as procedures.
create policy patient_field_definitions_select on public.patient_field_definitions
  for select
  using (public.has_any_clinic_role(clinic_id));

create policy patient_field_definitions_insert on public.patient_field_definitions
  for insert
  with check (public.has_clinic_role(clinic_id, 'admin'));

create policy patient_field_definitions_update on public.patient_field_definitions
  for update
  using (public.has_clinic_role(clinic_id, 'admin'));

create policy patient_field_definitions_delete on public.patient_field_definitions
  for delete
  using (public.has_clinic_role(clinic_id, 'admin'));

-- ============================================================
-- Prescription templates: admin gets view/rename/delete (management
-- only -- the doctor is still the only one who creates a template, from
-- the consultation screen). Cascade template_items on template delete --
-- unlike medicines/procedures (NO ACTION, protecting real historical
-- bills/prescriptions), a template's own items have no independent
-- historical meaning once the template they belong to is gone.
-- ============================================================
create policy prescription_templates_select_admin on public.prescription_templates
  for select
  using (public.has_clinic_role(clinic_id, 'admin'));

create policy prescription_templates_update_admin on public.prescription_templates
  for update
  using (public.has_clinic_role(clinic_id, 'admin'));

create policy prescription_templates_delete_admin on public.prescription_templates
  for delete
  using (public.has_clinic_role(clinic_id, 'admin'));

alter table public.prescription_template_items
  drop constraint prescription_template_items_template_id_fkey,
  add constraint prescription_template_items_template_id_fkey
    foreign key (template_id) references public.prescription_templates(id) on delete cascade;

-- ============================================================
-- Duplicate patient merge. Reassigns the two tables that actually carry
-- patient_id (checked directly against information_schema, not assumed:
-- visits, patient_comments -- visit_pricing/bills key off visit_id and
-- follow automatically). Blocks if either patient has an open visit
-- today (arrived today, not yet paid) -- a merge mid-visit would pull
-- the rug out from under whichever screen has it open. Keeps whichever
-- patient id is actually older, regardless of which the caller passes
-- first, and raises rather than silently swapping if the caller got it
-- backwards.
-- ============================================================
create or replace function public.merge_patients(p_patient_a uuid, p_patient_b uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_clinic_b uuid;
  v_created_a timestamptz;
  v_created_b timestamptz;
  v_keep_id uuid;
  v_remove_id uuid;
  v_today timestamptz := date_trunc('day', now());
begin
  select clinic_id, created_at into v_clinic_id, v_created_a from public.patients where id = p_patient_a;
  select clinic_id, created_at into v_clinic_b, v_created_b from public.patients where id = p_patient_b;

  if v_clinic_id is null or v_clinic_b is null then
    raise exception 'unknown patient';
  end if;
  if v_clinic_id <> v_clinic_b then
    raise exception 'patients belong to different clinics';
  end if;
  if not public.has_clinic_role(v_clinic_id, 'admin') then
    raise exception 'only admin can merge patients';
  end if;

  if v_created_a <= v_created_b then
    v_keep_id := p_patient_a;
    v_remove_id := p_patient_b;
  else
    v_keep_id := p_patient_b;
    v_remove_id := p_patient_a;
  end if;

  if exists (
    select 1 from public.visits
    where patient_id in (v_keep_id, v_remove_id)
      and arrived_at >= v_today
      and stage <> 'paid'
  ) then
    raise exception 'one of these patients has an open visit today -- resolve it before merging';
  end if;

  update public.visits set patient_id = v_keep_id where patient_id = v_remove_id;
  update public.patient_comments set patient_id = v_keep_id where patient_id = v_remove_id;

  delete from public.patients where id = v_remove_id;

  return v_keep_id;
end;
$$;

revoke execute on function public.merge_patients(uuid, uuid) from public;
grant execute on function public.merge_patients(uuid, uuid) to authenticated;
