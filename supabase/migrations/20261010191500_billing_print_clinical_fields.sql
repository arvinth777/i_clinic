-- Reception prints the issued clinical fields through the existing stage/role-scoped read.
-- Direct prescription history remains doctor-only; no RLS policies are widened.
drop function public.get_visit_billing_detail(uuid);
create function public.get_visit_billing_detail(p_visit_id uuid)
returns table (
  kind text,
  description text,
  unit_price_paise bigint,
  drug_type text,
  strength text,
  before_after_food text,
  dosage_frequency text,
  duration_days int,
  notes text,
  quantity int,
  stock_unit text,
  line_total_paise bigint,
  diagnosis text,
  advice text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_stage text;
  v_fee bigint;
begin
  select clinic_id, stage into v_clinic_id, v_stage
  from public.visits
  where id = p_visit_id;

  if v_clinic_id is null then
    return;
  end if;

  if not (
    public.has_clinic_role(v_clinic_id, 'doctor')
    or (public.has_clinic_role(v_clinic_id, 'receptionist') and v_stage in ('ready_at_reception', 'paid'))
  ) then
    return;
  end if;

  select consultation_fee_paise into v_fee from public.clinics where id = v_clinic_id;

  return query
  select 'consultation'::text, 'Consultation'::text, v_fee,
         null::text, null::text, null::text, null::text, null::int, null::text, 1, null::text, v_fee, null::text, null::text
  union all
  select 'procedure'::text, p.name, vp.price_paise,
         null::text, null::text, null::text, null::text, null::int, null::text, 1, null::text, vp.price_paise, null::text, null::text
  from public.visit_procedures vp
  join public.procedures p on p.id = vp.procedure_id
  where vp.visit_id = p_visit_id
  union all
  select 'medicine'::text, m.name, pi.unit_price_paise,
         pi.drug_type, pi.strength, pi.before_after_food, pi.dosage_frequency, pi.duration_days, pi.notes, pi.quantity_dispensed, pi.stock_unit, pi.unit_price_paise * pi.quantity_dispensed, pr.diagnosis, pr.advice
  from public.prescription_items pi
  join public.prescriptions pr on pr.id = pi.prescription_id
  join public.medicines m on m.id = pi.medicine_id
  where pr.visit_id = p_visit_id;
end;
$$;

revoke execute on function public.get_visit_billing_detail(uuid) from public, anon, authenticated;
grant execute on function public.get_visit_billing_detail(uuid) to authenticated;
