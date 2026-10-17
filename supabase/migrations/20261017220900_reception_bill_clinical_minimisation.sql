-- Reception receives only the molecule/strength/quantity needed to select stock
-- and the amounts needed for a receipt; diagnosis and dosing stay doctor-only.
create or replace function public.get_reception_bill(p_visit_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.visits; items jsonb;
begin
  select * into v from public.visits where id = p_visit_id;
  if v.id is null then return null; end if;
  if not (public.has_clinic_role(v.clinic_id, 'receptionist') or public.has_clinic_role(v.clinic_id, 'doctor')) or v.stage not in ('ready_to_bill', 'paid') then
    raise exception 'reception handoff required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'prescription_item_id', pi.id, 'medicine_id', pi.medicine_id,
    'molecule_name', pi.molecule_name, 'strength', pi.strength,
    'quantity', pi.quantity_dispensed, 'stock_unit', pi.stock_unit
  ) order by pi.created_at, pi.id), '[]'::jsonb)
  into items from public.prescriptions p join public.prescription_items pi on pi.prescription_id = p.id
    where p.visit_id = v.id;
  return jsonb_build_object('consultation_charge_paise', v.consultation_charge_paise, 'medicines', items);
end;
$$;
revoke execute on function public.get_reception_bill(uuid) from public, anon, authenticated;
grant execute on function public.get_reception_bill(uuid) to authenticated;

create or replace function public.get_visit_billing_detail(p_visit_id uuid)
returns table (
  kind text, description text, unit_price_paise bigint, drug_type text,
  strength text, before_after_food text, dosage_frequency text,
  duration_days int, notes text, quantity int, stock_unit text,
  line_total_paise bigint, diagnosis text, advice text
)
language plpgsql security definer set search_path = '' as $$
declare v_clinic_id uuid; v_stage text; v_fee bigint; v_doctor boolean;
begin
  select clinic_id, stage, consultation_charge_paise into v_clinic_id, v_stage, v_fee
    from public.visits where id = p_visit_id;
  if v_clinic_id is null then return; end if;
  v_doctor := public.has_clinic_role(v_clinic_id, 'doctor');
  if not (v_doctor or (public.has_clinic_role(v_clinic_id, 'receptionist') and v_stage in ('ready_to_bill', 'paid'))) then return; end if;
  return query
  select 'consultation'::text, 'Consultation'::text, v_fee,
         null::text, null::text, null::text, null::text, null::int,
         null::text, 1, null::text, v_fee, null::text, null::text
  union all
  select 'procedure'::text, p.name, vp.price_paise,
         null::text, null::text, null::text, null::text, null::int,
         null::text, 1, null::text, vp.price_paise, null::text, null::text
  from public.visit_procedures vp join public.procedures p on p.id = vp.procedure_id
  where vp.visit_id = p_visit_id
  union all
  select 'medicine'::text, pi.molecule_name, pi.unit_price_paise,
         case when v_doctor then pi.drug_type else null end,
         pi.strength,
         case when v_doctor then pi.before_after_food else null end,
         case when v_doctor then pi.dosage_frequency else null end,
         case when v_doctor then pi.duration_days else null end,
         case when v_doctor then pi.notes else null end,
         pi.quantity_dispensed, pi.stock_unit,
         pi.unit_price_paise * pi.quantity_dispensed,
         case when v_doctor then pr.diagnosis else null end,
         case when v_doctor then pr.advice else null end
  from public.prescription_items pi join public.prescriptions pr on pr.id = pi.prescription_id
  where pr.visit_id = p_visit_id;
end;
$$;
revoke execute on function public.get_visit_billing_detail(uuid) from public, anon, authenticated;
grant execute on function public.get_visit_billing_detail(uuid) to authenticated;
