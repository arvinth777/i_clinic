-- Fixes the two findings from the security/code review, and nothing else.

-- ============================================================
-- Finding 1: receptionist could still touch an already-paid visit
--
-- phase1_core_schema.sql's guard_visit_reopen trigger was deliberately
-- stripped (the reopen *mechanism* -- stage-flip vs. correction-bill-only
-- -- is genuinely undecided, recorded in that file's header). Stripping it
-- left visits_update identical for doctor and receptionist, with nothing
-- stopping a receptionist's client from flipping a paid visit's stage back
-- via a raw UPDATE.
--
-- This migration encodes only the settled half: doctor unchanged, full
-- access regardless of stage. Receptionist restricted to non-paid rows.
-- It does NOT decide what reopening does mechanically -- that stays
-- unbuilt.
--
-- USING gates the OLD row: a receptionist can't touch a visit that's
-- already paid, full stop. WITH CHECK is deliberately *not* a bare reuse
-- of USING -- if it were, she could never set stage to 'paid' either,
-- which would break confirming payment (the transition into 'paid' is
-- exactly what she does). WITH CHECK only re-affirms her clinic role on
-- the resulting row.
-- ============================================================

drop policy visits_update on public.visits;

create policy visits_update_doctor on public.visits
  for update
  using (has_clinic_role(clinic_id, 'doctor'));

create policy visits_update_receptionist on public.visits
  for update
  using (has_clinic_role(clinic_id, 'receptionist') and stage <> 'paid')
  with check (has_clinic_role(clinic_id, 'receptionist'));

-- ============================================================
-- Finding 2: no one could actually author a correction bill under RLS
--
-- bills_insert only ever checked receptionist -- the only way the seed
-- migration's correction-row case worked was that migrations run with
-- elevated privilege, bypassing RLS entirely. In the real app, nobody
-- could insert a bill with corrects_bill_id set.
--
-- Split by corrects_bill_id, not by an explicit "is this a correction"
-- flag: receptionist creates bills (corrects_bill_id is null), doctor
-- creates corrections (corrects_bill_id is not null). Neither can do the
-- other's job.
-- ============================================================

drop policy bills_insert on public.bills;

create policy bills_insert_receptionist on public.bills
  for insert
  with check (has_clinic_role(clinic_id, 'receptionist') and corrects_bill_id is null);

create policy bills_insert_doctor on public.bills
  for insert
  with check (has_clinic_role(clinic_id, 'doctor') and corrects_bill_id is not null);

-- bill_line_items has no corrects_bill_id of its own -- it follows the
-- parent bill's. Both roles already have bills_select, so this subquery
-- needs no elevated privilege to evaluate.

drop policy bill_line_items_insert on public.bill_line_items;

create policy bill_line_items_insert_receptionist on public.bill_line_items
  for insert
  with check (
    has_clinic_role(clinic_id, 'receptionist')
    and exists (
      select 1 from public.bills b
      where b.id = bill_line_items.bill_id
        and b.corrects_bill_id is null
    )
  );

create policy bill_line_items_insert_doctor on public.bill_line_items
  for insert
  with check (
    has_clinic_role(clinic_id, 'doctor')
    and exists (
      select 1 from public.bills b
      where b.id = bill_line_items.bill_id
        and b.corrects_bill_id is not null
    )
  );
