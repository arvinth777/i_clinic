-- ============================================================
-- prescription_templates / prescription_template_items
--
-- "Saved templates" from the prescription-writing spec: a doctor-defined
-- named drug set that one click drops into a new prescription's draft.
-- Same shape and sensitivity as prescriptions/prescription_items
-- (doctor-only) -- a template is just a prescription that hasn't been
-- written for a specific patient yet, so it carries the same clinical
-- content and the same RLS.
-- ============================================================

create table public.prescription_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  name text not null,
  created_at timestamptz not null default now()
);

create index prescription_templates_clinic_id_idx on public.prescription_templates (clinic_id);

alter table public.prescription_templates enable row level security;

create policy prescription_templates_select on public.prescription_templates
  for select
  using (public.has_clinic_role(clinic_id, 'doctor'));

create policy prescription_templates_insert on public.prescription_templates
  for insert
  with check (public.has_clinic_role(clinic_id, 'doctor'));

create policy prescription_templates_update on public.prescription_templates
  for update
  using (public.has_clinic_role(clinic_id, 'doctor'));

create policy prescription_templates_delete on public.prescription_templates
  for delete
  using (public.has_clinic_role(clinic_id, 'doctor'));

create table public.prescription_template_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  template_id uuid not null references public.prescription_templates(id),
  medicine_id uuid not null references public.medicines(id),
  drug_type text check (drug_type in ('Tablet', 'Syrup', 'Capsule', 'Powder', 'Injection', 'Other')),
  strength text,
  before_after_food text check (before_after_food in ('Before food', 'After food', 'Either')),
  dosage_frequency text check (dosage_frequency in ('1-0-1', '1-1-1', '0-0-1', '1-0-0', 'SOS', 'Other')),
  duration_days int not null check (duration_days > 0),
  notes text,
  created_at timestamptz not null default now()
);

create index prescription_template_items_template_id_idx on public.prescription_template_items (template_id);

alter table public.prescription_template_items enable row level security;

create policy prescription_template_items_select on public.prescription_template_items
  for select
  using (public.has_clinic_role(clinic_id, 'doctor'));

create policy prescription_template_items_insert on public.prescription_template_items
  for insert
  with check (public.has_clinic_role(clinic_id, 'doctor'));

create policy prescription_template_items_update on public.prescription_template_items
  for update
  using (public.has_clinic_role(clinic_id, 'doctor'));

create policy prescription_template_items_delete on public.prescription_template_items
  for delete
  using (public.has_clinic_role(clinic_id, 'doctor'));
