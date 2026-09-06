-- User decision on Phase A's flagged security-review exception:
-- deciding two records are the same person is a judgment about a
-- patient, not configuration. The doctor already has a legitimate
-- patients_select read; admin does not and keeps none -- the
-- admin-cannot-read-patients rule in docs/security-review.md stays
-- literal, with no exception, by moving merge off admin entirely
-- instead of narrowing the exception further.
--
-- admin_search_patients_for_merge is dropped outright, not deprecated:
-- the doctor's own existing search_patients RPC (SECURITY INVOKER, runs
-- under patients_select's real RLS) already covers this search with no
-- new function needed.
drop function public.admin_search_patients_for_merge(uuid, text);

-- merge_patients: same body, only the role check changes (admin -> doctor).
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
  if not public.has_clinic_role(v_clinic_id, 'doctor') then
    raise exception 'only a doctor can merge patients';
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

-- Grants are unchanged (authenticated only, already correctly closed to
-- anon/public from the original migration + its follow-up fix) -- the
-- has_clinic_role check inside the function is what actually gates this
-- to doctor now, same as before with admin.
