-- Phase C (docs/build-plan.md): payments completed. Cash and UPI already
-- worked (Billing.tsx already builds a real UPI QR; confirm_bill already
-- accepts payment_method 'pay_later' and closes the visit as billed --
-- pinned down by scripts/settle-bill-test.mjs section 1 rather than
-- re-built). What's new: settling a pay_later bill later, and the
-- unpaid list reception works it from.
--
-- ============================================================
-- bill_settlements
--
-- Non-negotiable #3 (AGENTS.md): "Paid bills are immutable. A
-- correction writes a new row referencing the original. Never UPDATE a
-- paid bill in place." Settling is not a correction (the amount and
-- payment_method on the original bill never change) -- it's a new,
-- independent fact: this pay_later bill was later actually paid, when,
-- and how. A new table, not corrects_bill_id (that mechanism is for
-- amount corrections when pricing drifted, a different concern).
--
-- unique(bill_id) is the only guard needed against settling the same
-- bill twice -- a second insert attempt just violates the constraint,
-- no separate locking/check-then-insert logic required.
--
-- No insert policy for any client role: only settle_bill (below) can
-- create a row, so its own validation (reception-only, pay_later-only)
-- can never be bypassed by a direct client insert. Same posture as
-- medicine_stock -- a table only a controlled function may write.
-- ============================================================

create table public.bill_settlements (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  bill_id uuid not null unique references public.bills(id),
  payment_method text not null check (payment_method in ('cash', 'upi')),
  settled_by uuid not null references auth.users(id),
  settled_at timestamptz not null default now(),
  notes text
);

create index bill_settlements_clinic_id_idx on public.bill_settlements (clinic_id);

alter table public.bill_settlements enable row level security;

create policy bill_settlements_select on public.bill_settlements
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

-- ============================================================
-- unpaid_bills
--
-- Same idiom as bills_needing_reconciliation: security_invoker so the
-- view enforces the querying user's own RLS on bills/visits/patients,
-- not the view owner's -- admin gets nothing from this view for the
-- same reason admin gets nothing from patients directly, with no
-- special-case needed here.
-- ============================================================

create view public.unpaid_bills
  with (security_invoker = true)
  as
  select
    b.id as bill_id,
    b.clinic_id,
    b.visit_id,
    b.final_amount_paise,
    b.confirmed_at,
    v.token_number,
    v.arrived_at,
    p.name as patient_name
  from public.bills b
  join public.visits v on v.id = b.visit_id
  join public.patients p on p.id = v.patient_id
  where b.payment_method = 'pay_later'
    and not exists (select 1 from public.bill_settlements s where s.bill_id = b.id);

-- ============================================================
-- settle_bill
--
-- security definer, same reasoning as confirm_bill: the caller
-- (receptionist) already has bills/bill_settlements SELECT, but the
-- validation here (pay_later-only, reception-only) must hold regardless
-- of any future grant change, and bill_settlements has no insert policy
-- for any client role -- this is the only path that can create one.
-- ============================================================

create or replace function public.settle_bill(p_bill_id uuid, p_payment_method text, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_bill_payment_method text;
  v_id uuid;
begin
  select clinic_id, payment_method into v_clinic_id, v_bill_payment_method
  from public.bills
  where id = p_bill_id;

  if v_clinic_id is null then
    raise exception 'unknown bill %', p_bill_id;
  end if;

  if not public.has_clinic_role(v_clinic_id, 'receptionist') then
    raise exception 'only reception can settle a bill';
  end if;

  if v_bill_payment_method <> 'pay_later' then
    raise exception 'only a pay-later bill can be settled -- it was never unpaid';
  end if;

  if p_payment_method not in ('cash', 'upi') then
    raise exception 'settle payment method must be cash or upi';
  end if;

  insert into public.bill_settlements (clinic_id, bill_id, payment_method, settled_by, notes)
  values (v_clinic_id, p_bill_id, p_payment_method, auth.uid(), p_notes)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.settle_bill(uuid, text, text) from public, anon, authenticated;
grant execute on function public.settle_bill(uuid, text, text) to authenticated;

-- ============================================================
-- admin_set_clinic_upi_vpa
--
-- clinics has no update policy at all today (creating one is a
-- migration/service_role action, per the original schema's own
-- comment) -- deliberately not opened with a blanket admin UPDATE
-- policy, since that would also expose next_token_number (an internal
-- counter no one should hand-edit) to casual editing. A narrow write,
-- same idiom as every other admin-scoped write in this project: one
-- column, admin-gated inside the function, not a relaxation of RLS.
-- ============================================================

create or replace function public.admin_set_clinic_upi_vpa(p_clinic_id uuid, p_upi_vpa text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_clinic_role(p_clinic_id, 'admin') then
    raise exception 'only admin can configure the clinic UPI VPA';
  end if;

  update public.clinics
  set upi_vpa = nullif(trim(p_upi_vpa), '')
  where id = p_clinic_id;
end;
$$;

revoke execute on function public.admin_set_clinic_upi_vpa(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_clinic_upi_vpa(uuid, text) to authenticated;
