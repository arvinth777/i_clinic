-- One-time data backfill, found while reviewing the flow live: 20 visits
-- (the clinic's original synthetic seed patients -- Fatima Begum, Rajesh
-- Kumar, etc.) reached stage='paid' with visit_pricing.final_amount_set
-- still false. They were created directly by the seed migration, before
-- confirm_bill existed, so nothing ever flipped the flag. Symptom: Billing.
-- tsx's "waiting for the doctor to confirm the amount" state incorrectly
-- showed on an already-closed, already-paid visit.
--
-- Not a live bug going forward -- 20260906160000's backstop trigger already
-- guarantees no new visit can reach packing (and therefore paid) in this
-- state. This is purely historical cleanup.
--
-- Corrects visit_pricing only, backfilling from each visit's own existing
-- bill (the original, uncorrected one) -- bills themselves are never
-- touched or reinterpreted (non-negotiable #3: paid bills are immutable).
-- Wrapped in the same recompute-suppression GUC recompute_visit_pricing
-- itself uses, since this is a correction, not a doctor engaging with
-- pricing: final_amount_set is still forced true explicitly below, but
-- revision_number does not bump for a value that isn't actually changing
-- from the doctor's perspective.

do $$
begin
  perform set_config('app.pricing_recompute', 'true', true);

  update public.visit_pricing vp
  set final_amount_paise = b.final_amount_paise,
      final_amount_set = true
  from public.visits v
  join lateral (
    select final_amount_paise
    from public.bills
    where visit_id = v.id and corrects_bill_id is null
    order by confirmed_at desc
    limit 1
  ) b on true
  where vp.visit_id = v.id
    and v.stage = 'paid'
    and vp.final_amount_set = false;

  perform set_config('app.pricing_recompute', 'false', true);
end $$;
