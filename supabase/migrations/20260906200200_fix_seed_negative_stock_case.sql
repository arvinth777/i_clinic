-- The deferred negative-stock seed case in 20260906200000 picked
-- "the first clinic" arbitrarily (select id from public.clinics limit
-- 1), which landed on Clinic B -- the isolation-test-only clinic that
-- has no receptionist role at all. Its own inner "find a receptionist"
-- subquery correctly found nothing and silently inserted zero
-- stock_movements rows (an insert-select with an empty source isn't an
-- error), so the medicine/patient/visit/prescription rows were created
-- but the actual negative-stock movement never landed.
--
-- Removes that misplaced synthetic data (staging only, clearly named,
-- created moments ago by this same phase) and re-seeds it correctly
-- against Clinic A -- the one real seed clinic with a full role set,
-- same as every other piece of synthetic data in this project.

delete from public.prescription_items
where medicine_id in (select id from public.medicines where name = 'Seed Negative Stock Medicine');

delete from public.prescriptions
where visit_id in (select id from public.visits where complaint = 'seed: negative stock case');

-- visit_pricing.visit_id has no cascade (NO ACTION, like every other FK
-- into visits) -- must go before the visit itself.
delete from public.visit_pricing
where visit_id in (select id from public.visits where complaint = 'seed: negative stock case');

delete from public.visits where complaint = 'seed: negative stock case';
delete from public.patients where name = 'Seed Negative Stock Patient';
delete from public.medicines where name = 'Seed Negative Stock Medicine';

do $$
declare
  v_clinic_id uuid;
  v_counter_id uuid;
  v_medicine_id uuid;
  v_patient_id uuid;
  v_visit_id uuid;
  v_prescription_id uuid;
  v_receptionist_id uuid;
begin
  select id into v_clinic_id from public.clinics where name = 'Clinic A (staging seed)';
  select id into v_counter_id from public.stock_points where clinic_id = v_clinic_id and name = 'Counter';
  select u.id into v_receptionist_id
  from auth.users u
  join public.user_roles ur on ur.user_id = u.id
  where ur.clinic_id = v_clinic_id and ur.role = 'receptionist'
  limit 1;

  if v_clinic_id is null or v_counter_id is null or v_receptionist_id is null then
    raise exception 'seed prerequisites missing: clinic=%, counter=%, receptionist=%', v_clinic_id, v_counter_id, v_receptionist_id;
  end if;

  insert into public.medicines (clinic_id, name, price_paise)
  values (v_clinic_id, 'Seed Negative Stock Medicine', 4000)
  returning id into v_medicine_id;

  insert into public.patients (clinic_id, name, age)
  values (v_clinic_id, 'Seed Negative Stock Patient', 50)
  returning id into v_patient_id;

  insert into public.visits (clinic_id, patient_id, arrived_at, complaint, stage, closed_at)
  values (v_clinic_id, v_patient_id, now() - interval '1 day', 'seed: negative stock case', 'paid', now() - interval '1 day')
  returning id into v_visit_id;

  insert into public.prescriptions (clinic_id, visit_id)
  values (v_clinic_id, v_visit_id)
  returning id into v_prescription_id;

  insert into public.prescription_items (clinic_id, prescription_id, medicine_id, duration_days, quantity_dispensed)
  values (v_clinic_id, v_prescription_id, v_medicine_id, 5, 10);

  -- no purchase was ever recorded for this medicine -- this movement
  -- takes it straight to -10, the "sold out but the doctor still
  -- prescribed it" case a monthly count needs to be able to surface.
  insert into public.stock_movements (clinic_id, medicine_id, stock_point_id, quantity_delta, reason, reference_id, created_by)
  values (v_clinic_id, v_medicine_id, v_counter_id, -10, 'dispensed', v_visit_id, v_receptionist_id);
end $$;
