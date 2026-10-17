-- A completed consultation makes the next consultation a return visit even
-- when reception has not collected its bill yet. No-show alone does not.
create or replace function public.default_visit_consultation_charge()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.consultation_charge_paise := case when exists (
    select 1 from public.visits v where v.patient_id = new.patient_id
      and v.clinic_id = new.clinic_id and v.stage in ('ready_to_bill', 'paid')
  ) then 20000 else 25000 end;
  return new;
end;
$$;
revoke execute on function public.default_visit_consultation_charge() from public, anon, authenticated;
