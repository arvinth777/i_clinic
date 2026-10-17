-- Issuing the doctor's prescription no longer depends on medicine-price approval.
create or replace function public.enqueue_prescription_archive()
returns trigger language plpgsql security definer set search_path = '' as $$
declare medicines jsonb; version bigint;
begin
  if new.stage = 'ready_to_bill' and old.stage is distinct from new.stage then
    select coalesce(jsonb_agg(jsonb_build_object(
      'kind', 'medicine', 'description', coalesce(nullif(btrim(m.molecule_name), ''), m.name),
      'strength', pi.strength, 'drug_type', pi.drug_type,
      'before_after_food', pi.before_after_food, 'dosage_frequency', pi.dosage_frequency,
      'duration_days', pi.duration_days, 'notes', pi.notes,
      'quantity', pi.quantity_dispensed, 'stock_unit', pi.stock_unit,
      'unit_price_paise', 0) order by pi.created_at, pi.id), '[]'::jsonb),
      (select revision_number from public.visit_pricing where visit_id = new.id)
    into medicines, version
    from public.prescriptions p join public.prescription_items pi on pi.prescription_id = p.id
    join public.medicines m on m.id = pi.medicine_id where p.visit_id = new.id;
    if jsonb_array_length(medicines) = 0 then raise exception 'prescription required for archive'; end if;
    insert into public.document_archives(clinic_id, visit_id, kind, source_id, source_version, snapshot)
    values(new.clinic_id, new.id, 'prescription', new.id, version,
      jsonb_build_object('kind', 'prescription', 'clinic', public.archive_clinic_snapshot(new.clinic_id),
        'visit', public.archive_visit_snapshot(new.id, true), 'medicines', medicines))
    on conflict(kind, source_id, source_version) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.enqueue_prescription_archive() from public, anon, authenticated;
