-- Phase G fix pass (docs/STATUS.md, Critical finding #3): the PRD
-- requires the consultation fee be admin-configurable ("Consultation fee
-- amount... Add, edit, or remove any of the above" -- Screens > Admin/
-- Settings; "Always ₹250, not editable per visit (changed in Admin
-- only)" -- Forms > Visit Pricing), but consultation_fee_paise has been a
-- hardcoded table default since Phase 1 with no setter anywhere. Same
-- idiom as admin_set_clinic_upi_vpa/admin_set_clinic_doctor_info: clinics
-- has no update policy at all (a blanket admin UPDATE would also expose
-- next_token_number to casual editing), so this is a narrow, single-column,
-- admin-gated write.
--
-- Changing the fee does not retroactively touch any existing visit's
-- calculated_total_paise -- recompute_visit_pricing (20260906120000) only
-- re-reads consultation_fee_paise when a visit's own procedures/
-- prescription_items change, same as it already does for medicine catalog
-- price drift (that migration's own header names this as deliberate, not
-- a gap this fix should also close). A new visit created after this
-- change gets the new fee via create_visit_pricing's snapshot at
-- check-in; an open visit is unaffected until its own line items change.

create or replace function public.admin_set_clinic_fee(p_clinic_id uuid, p_fee_paise bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_clinic_role(p_clinic_id, 'admin') then
    raise exception 'only admin can configure the consultation fee';
  end if;

  if p_fee_paise < 0 then
    raise exception 'consultation fee cannot be negative';
  end if;

  update public.clinics
  set consultation_fee_paise = p_fee_paise
  where id = p_clinic_id;
end;
$$;

revoke execute on function public.admin_set_clinic_fee(uuid, bigint) from public, anon, authenticated;
grant execute on function public.admin_set_clinic_fee(uuid, bigint) to authenticated;
