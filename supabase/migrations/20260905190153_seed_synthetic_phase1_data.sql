-- Synthetic seed data, staging only. No real patient data anywhere in this
-- file, per AGENTS.md's staging/synthetic-data rule.
--
-- Deliberately missing three of the ten originally-requested cases, and why:
--   - negative stock on a dispensed item        -- waits on stock tables (phase 2)
--   - an expired, unarrived pre-registration     -- waits on pre-registration (ships with WhatsApp)
--   - a pharma rep queued behind later arrivals  -- waits on rep support
-- None of those tables exist in this schema yet. Per AGENTS.md's Phase 2
-- checkpoint, each one's seed case is added in the same migration that adds
-- its table -- not bolted on here as a workaround.
--
-- The seven cases that do map to the schema as built, plus a second clinic
-- for tenant isolation testing, all below.

do $$
declare
  v_clinic_a uuid;
  v_clinic_b uuid;
  v_doctor_a uuid;
  v_reception_a uuid;
  v_doctor_b uuid;
  v_admin_only uuid;
  v_patient uuid;
  v_visit uuid;
  v_bill uuid;
begin
  -- Test users are created by hand in the dashboard (see the wizard script
  -- used to make them) -- looked up by email here, never hardcoded UIDs,
  -- and this script never sees or needs their passwords.
  select id into v_doctor_a from auth.users where email = 'doctor.a@staging.test';
  select id into v_reception_a from auth.users where email = 'reception.a@staging.test';
  select id into v_doctor_b from auth.users where email = 'doctor.b@staging.test';
  select id into v_admin_only from auth.users where email = 'admin.only@staging.test';

  if v_doctor_a is null or v_reception_a is null or v_doctor_b is null or v_admin_only is null then
    raise exception 'one or more staging test users not found in auth.users -- create them first (see create-staging-test-users.sh)';
  end if;

  -- ============================================================
  -- Two clinics, and roles
  -- ============================================================

  insert into public.clinics (name) values ('Clinic A (staging seed)') returning id into v_clinic_a;
  insert into public.clinics (name) values ('Clinic B (staging seed)') returning id into v_clinic_b;

  insert into public.user_roles (user_id, clinic_id, role) values
    (v_doctor_a, v_clinic_a, 'doctor'),
    (v_doctor_a, v_clinic_a, 'admin'),
    (v_reception_a, v_clinic_a, 'receptionist'),
    (v_doctor_b, v_clinic_b, 'doctor'),
    (v_admin_only, v_clinic_a, 'admin');

  -- ============================================================
  -- Case: a ₹0 bill (100% discount)
  -- ============================================================

  insert into public.patients (clinic_id, name, age, gender, phone)
    values (v_clinic_a, 'Meena Krishnan', 58, 'Female', '9840011111')
    returning id into v_patient;

  insert into public.visits (clinic_id, patient_id, arrived_at, complaint)
    values (v_clinic_a, v_patient, now() - interval '3 hours', 'Chronic lower back pain, follow-up')
    returning id into v_visit;

  update public.visit_pricing set final_amount_paise = 0 where visit_id = v_visit;
  update public.visits set stage = 'paid' where id = v_visit;

  insert into public.bills (clinic_id, visit_id, final_amount_paise, pricing_revision_at_confirm, payment_method, confirmed_by)
  values (v_clinic_a, v_visit, 0, 1, 'cash', v_reception_a);

  -- ============================================================
  -- Case: a partially discounted bill
  -- ============================================================

  insert into public.patients (clinic_id, name, age, gender, phone)
    values (v_clinic_a, 'Suresh Babu', 64, 'Male', '9840022222')
    returning id into v_patient;

  insert into public.visits (clinic_id, patient_id, arrived_at, complaint)
    values (v_clinic_a, v_patient, now() - interval '2 hours 40 minutes', 'Post-procedure review')
    returning id into v_visit;

  update public.visit_pricing set final_amount_paise = 15000 where visit_id = v_visit;
  update public.visits set stage = 'paid' where id = v_visit;

  insert into public.bills (clinic_id, visit_id, final_amount_paise, pricing_revision_at_confirm, payment_method, confirmed_by)
  values (v_clinic_a, v_visit, 15000, 1, 'upi', v_reception_a);

  -- ============================================================
  -- Case: amount revised after the receptionist had the bill open
  --
  -- Left unpaid on purpose -- this is the in-flight moment the case
  -- describes, not a closed visit. Stage moves to ready_at_reception (the
  -- receptionist opening it) before the revision, matching the real
  -- ordering.
  -- ============================================================

  insert into public.patients (clinic_id, name, age, gender, phone)
    values (v_clinic_a, 'Lakshmi Iyer', 71, 'Female', '9840033333')
    returning id into v_patient;

  insert into public.visits (clinic_id, patient_id, arrived_at, complaint)
    values (v_clinic_a, v_patient, now() - interval '1 hour 20 minutes', 'Palliative pain review')
    returning id into v_visit;

  update public.visits set stage = 'ready_at_reception' where id = v_visit;
  update public.visit_pricing set final_amount_paise = 20000 where visit_id = v_visit;

  -- ============================================================
  -- Case: visit closed offline, synced with a stale-amount mismatch
  --
  -- The bill is inserted first, snapshotting revision 0 -- representing the
  -- receptionist confirming payment offline against what she saw. The
  -- doctor's revision is applied after -- representing it syncing in once
  -- reconnected. Same visit_pricing row, still at revision 0 when the bill
  -- captures it. This is exactly what bills_needing_reconciliation exists
  -- to catch: no trigger flags it (bills are immutable, nothing can set a
  -- flag on this row after the fact), the view derives it live.
  -- ============================================================

  insert into public.patients (clinic_id, name, age, gender, phone)
    values (v_clinic_a, 'Ganesan Pillai', 67, 'Male', '9840044444')
    returning id into v_patient;

  insert into public.visits (clinic_id, patient_id, arrived_at, complaint)
    values (v_clinic_a, v_patient, now() - interval '50 minutes', 'Post-op follow-up, offline during visit')
    returning id into v_visit;

  insert into public.bills (clinic_id, visit_id, final_amount_paise, pricing_revision_at_confirm, payment_method, confirmed_by)
  values (v_clinic_a, v_visit, 25000, 0, 'cash', v_reception_a);

  update public.visit_pricing set final_amount_paise = 10000 where visit_id = v_visit;
  update public.visits set stage = 'paid' where id = v_visit;

  -- ============================================================
  -- Case: a patient with no phone number
  -- ============================================================

  insert into public.patients (clinic_id, name, age, gender, phone)
    values (v_clinic_a, 'Fatima Begum', 45, 'Female', null)
    returning id into v_patient;

  insert into public.visits (clinic_id, patient_id, arrived_at, complaint)
    values (v_clinic_a, v_patient, now() - interval '30 minutes', 'New patient, walk-in');

  -- ============================================================
  -- Case: two patients with near-identical names (trigram search)
  -- ============================================================

  insert into public.patients (clinic_id, name, age, gender, phone)
    values (v_clinic_a, 'Rajesh Kumar', 39, 'Male', '9840055555');

  insert into public.patients (clinic_id, name, age, gender, phone)
    values (v_clinic_a, 'Rajeesh Kumar', 52, 'Male', '9840066666');

  -- ============================================================
  -- Case: a correction row against an already-paid bill
  -- ============================================================

  insert into public.patients (clinic_id, name, age, gender, phone)
    values (v_clinic_a, 'Venkat Rao', 60, 'Male', '9840077777')
    returning id into v_patient;

  insert into public.visits (clinic_id, patient_id, arrived_at, complaint)
    values (v_clinic_a, v_patient, now() - interval '5 hours', 'Consultation and procedure')
    returning id into v_visit;

  update public.visits set stage = 'paid' where id = v_visit;

  insert into public.bills (clinic_id, visit_id, final_amount_paise, pricing_revision_at_confirm, payment_method, confirmed_by)
  values (v_clinic_a, v_visit, 25000, 0, 'cash', v_reception_a)
  returning id into v_bill;

  -- The correction: doctor caught an error after the fact, wrote a new row
  -- referencing the original -- non-negotiable #3, never an UPDATE.
  insert into public.bills (clinic_id, visit_id, final_amount_paise, pricing_revision_at_confirm, payment_method, confirmed_by, corrects_bill_id)
  values (v_clinic_a, v_visit, 20000, 0, 'cash', v_doctor_a, v_bill);

  -- ============================================================
  -- Second clinic (Clinic B), with something in it -- the isolation test
  -- needs real rows on the other side of the boundary to attempt to reach,
  -- not an empty clinic that would pass by having nothing to leak.
  -- ============================================================

  insert into public.patients (clinic_id, name, age, gender, phone)
    values (v_clinic_b, 'Priya Sharma', 34, 'Female', '9840088888')
    returning id into v_patient;

  insert into public.visits (clinic_id, patient_id, arrived_at, complaint)
    values (v_clinic_b, v_patient, now() - interval '1 hour', 'Consultation')
    returning id into v_visit;

  update public.visits set stage = 'paid' where id = v_visit;

  insert into public.bills (clinic_id, visit_id, final_amount_paise, pricing_revision_at_confirm, payment_method, confirmed_by)
  values (v_clinic_b, v_visit, 25000, 0, 'cash', v_doctor_b);

  insert into public.patient_comments (clinic_id, patient_id, author_id, body)
  values (v_clinic_b, v_patient, v_doctor_b, 'Clinic B seed comment -- must never be readable from clinic A.');

end $$;
