-- Phase E (docs/build-plan.md): Reports -- daily, monthly, GST.
--
-- The whole phase turns on one constraint: admin sees financial
-- aggregates with zero row-level access to patients, visits, bills,
-- prescriptions, or patient_comments -- unchanged from every earlier
-- phase. Built as SECURITY DEFINER FUNCTIONS, not views: a view has no
-- way to check "does this caller hold role X" as part of its own
-- definition the way a function's imperative body can, and a
-- SECURITY DEFINER view was flagged by the advisor for exactly that gap.
--
-- Every function here derives clinic_id from the caller's own
-- user_roles row (auth.uid()) and NEVER accepts clinic_id as a
-- parameter -- accepting one would turn an aggregate report into a
-- cross-clinic read for any authenticated user, since these functions
-- run with the elevated privileges that let them bypass RLS in the
-- first place. This is the one invariant every function below must
-- hold with no exception: grep this file for "p_clinic_id" and expect
-- zero matches.
--
-- A small amount of SQL (the two-part "cash/upi billed same-day, plus
-- any pay_later bill settled that day" collections calculation) is
-- duplicated across get_daily_report/get_monthly_report/get_gst_report
-- rather than factored into a shared clinic_id-accepting helper. A
-- non-definer helper would still be RLS-safe called either directly or
-- nested inside these functions, but it would also be one more function
-- with a "p_clinic_id" parameter for a future reviewer (or this file's
-- own stated invariant, above) to have to reason about being safe
-- rather than simply confirm doesn't exist -- not worth it for ~8 lines
-- repeated three times.
--
-- Every function is gated to admin OR doctor: admin because this is the
-- entire point of the phase (financial aggregates without row-level
-- access), doctor because the PRD says so directly ("Discounts are
-- totalled monthly, so the doctor can see how much subsidised care
-- he's actually provided") even though the doctor's own RLS already
-- gives him full row-level access and could compute the same totals by
-- hand. Reception is not named in the PRD's Reports screen and is not
-- granted here.

-- ============================================================
-- get_daily_report
--
-- Collections: bills confirmed *today* via cash/upi, plus any
-- pay_later bill (confirmed on any earlier day) actually settled
-- *today* -- a cash-basis figure of money that changed hands today, not
-- an accrual figure of bills raised today. A pay_later bill confirmed
-- today contributes nothing until it's actually settled.
--
-- Discount: computed from bill_line_items' frozen line_total_paise per
-- bill (non-negotiable #3 -- never re-derive from visit_pricing, which
-- may have been revised since), not from a live calculated_total_paise.
--
-- needs_reconciliation_count: same live join as the existing
-- bills_needing_reconciliation view (current revision vs the snapshot
-- taken at confirm time, excluding anything already corrected) -- a
-- current outstanding count, not scoped to today specifically, same as
-- how stock warnings are "current state" rather than "today's activity".
-- ============================================================

create or replace function public.get_daily_report(p_date date default current_date)
returns table (
  collections_paise bigint,
  patient_count int,
  discount_paise bigint,
  needs_reconciliation_count int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_start timestamptz;
  v_end timestamptz;
begin
  select clinic_id into v_clinic_id
  from public.user_roles
  where user_id = auth.uid() and role in ('admin', 'doctor')
  limit 1;

  if v_clinic_id is null then
    raise exception 'only admin or doctor can view reports';
  end if;

  v_start := p_date::timestamptz;
  v_end := (p_date + 1)::timestamptz;

  return query
  select
    (
      coalesce((
        select sum(b.final_amount_paise) from public.bills b
        where b.clinic_id = v_clinic_id and b.payment_method in ('cash', 'upi')
          and b.confirmed_at >= v_start and b.confirmed_at < v_end
      ), 0)
      +
      coalesce((
        select sum(b.final_amount_paise) from public.bill_settlements s
        join public.bills b on b.id = s.bill_id
        where b.clinic_id = v_clinic_id
          and s.settled_at >= v_start and s.settled_at < v_end
      ), 0)
    )::bigint as collections_paise,
    coalesce((
      select count(distinct v.patient_id) from public.visits v
      where v.clinic_id = v_clinic_id and v.arrived_at >= v_start and v.arrived_at < v_end
    ), 0)::int as patient_count,
    coalesce((
      select sum(t.calc_total - t.final_amount_paise)
      from (
        select b.id, b.final_amount_paise, coalesce(sum(bli.line_total_paise), 0) as calc_total
        from public.bills b
        left join public.bill_line_items bli on bli.bill_id = b.id
        where b.clinic_id = v_clinic_id and b.confirmed_at >= v_start and b.confirmed_at < v_end
        group by b.id, b.final_amount_paise
      ) t
    ), 0)::bigint as discount_paise,
    coalesce((
      select count(*) from public.bills b
      join public.visit_pricing vp on vp.visit_id = b.visit_id
      where b.clinic_id = v_clinic_id
        and b.pricing_revision_at_confirm <> vp.revision_number
        and not exists (select 1 from public.bills c where c.corrects_bill_id = b.id)
    ), 0)::int as needs_reconciliation_count;
end;
$$;

revoke execute on function public.get_daily_report(date) from public, anon, authenticated;
grant execute on function public.get_daily_report(date) to authenticated;

-- ============================================================
-- get_stock_warnings_report
--
-- Not patient data at all -- medicine name and quantity identify
-- neither a patient nor a visit, so row-level output here (unlike the
-- money functions above) doesn't violate "totals only, no identifiers".
-- Same low-stock definition StockList.tsx already uses: total quantity
-- across every stock point, compared to the medicine's own threshold.
-- Only returns medicines actually in a warning state, not the full list.
-- ============================================================

create or replace function public.get_stock_warnings_report()
returns table (
  medicine_name text,
  total_quantity int,
  low_stock_threshold int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id
  from public.user_roles
  where user_id = auth.uid() and role in ('admin', 'doctor')
  limit 1;

  if v_clinic_id is null then
    raise exception 'only admin or doctor can view reports';
  end if;

  return query
  select m.name, coalesce(sum(ms.quantity), 0)::int as total_quantity, m.low_stock_threshold
  from public.medicines m
  left join public.medicine_stock ms on ms.medicine_id = m.id
  where m.clinic_id = v_clinic_id
  group by m.id, m.name, m.low_stock_threshold
  having coalesce(sum(ms.quantity), 0) < 0
      or (m.low_stock_threshold is not null and coalesce(sum(ms.quantity), 0) <= m.low_stock_threshold)
  order by m.name;
end;
$$;

revoke execute on function public.get_stock_warnings_report() from public, anon, authenticated;
grant execute on function public.get_stock_warnings_report() to authenticated;

-- ============================================================
-- get_monthly_report
--
-- One row per month, most recent p_months months including the current
-- one, oldest first -- "month over month" per the PRD. Same collections/
-- discount definitions as get_daily_report, scoped to each calendar
-- month instead of a single day.
-- ============================================================

create or replace function public.get_monthly_report(p_months int default 6)
returns table (
  month_start date,
  collections_paise bigint,
  patient_count int,
  discount_paise bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id
  from public.user_roles
  where user_id = auth.uid() and role in ('admin', 'doctor')
  limit 1;

  if v_clinic_id is null then
    raise exception 'only admin or doctor can view reports';
  end if;

  if p_months < 1 or p_months > 36 then
    raise exception 'p_months must be between 1 and 36';
  end if;

  return query
  with months as (
    select date_trunc('month', current_date - (n || ' months')::interval)::date as month_start
    from generate_series(0, p_months - 1) as n
  )
  select
    mo.month_start,
    (
      coalesce((
        select sum(b.final_amount_paise) from public.bills b
        where b.clinic_id = v_clinic_id and b.payment_method in ('cash', 'upi')
          and b.confirmed_at >= mo.month_start and b.confirmed_at < (mo.month_start + interval '1 month')
      ), 0)
      +
      coalesce((
        select sum(b.final_amount_paise) from public.bill_settlements s
        join public.bills b on b.id = s.bill_id
        where b.clinic_id = v_clinic_id
          and s.settled_at >= mo.month_start and s.settled_at < (mo.month_start + interval '1 month')
      ), 0)
    )::bigint as collections_paise,
    coalesce((
      select count(distinct v.patient_id) from public.visits v
      where v.clinic_id = v_clinic_id and v.arrived_at >= mo.month_start and v.arrived_at < (mo.month_start + interval '1 month')
    ), 0)::int as patient_count,
    coalesce((
      select sum(t.calc_total - t.final_amount_paise)
      from (
        select b.id, b.final_amount_paise, coalesce(sum(bli.line_total_paise), 0) as calc_total
        from public.bills b
        left join public.bill_line_items bli on bli.bill_id = b.id
        where b.clinic_id = v_clinic_id and b.confirmed_at >= mo.month_start and b.confirmed_at < (mo.month_start + interval '1 month')
        group by b.id, b.final_amount_paise
      ) t
    ), 0)::bigint as discount_paise
  from months mo
  order by mo.month_start;
end;
$$;

revoke execute on function public.get_monthly_report(int) from public, anon, authenticated;
grant execute on function public.get_monthly_report(int) to authenticated;

-- ============================================================
-- get_gst_report
--
-- "A tax-ready collections summary, exportable for the accountant"
-- (PRD) -- one aggregate row for whatever date range the admin picks.
-- No GST rate/tax-due computation is invented here: the PRD names no
-- rate or formula, and healthcare consultation is largely GST-exempt in
-- India in the first place -- this hands the accountant clean summary
-- figures to work from, not a filing.
-- ============================================================

create or replace function public.get_gst_report(p_start_date date, p_end_date date)
returns table (
  collections_paise bigint,
  discount_paise bigint,
  bill_count int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_start timestamptz;
  v_end timestamptz;
begin
  select clinic_id into v_clinic_id
  from public.user_roles
  where user_id = auth.uid() and role in ('admin', 'doctor')
  limit 1;

  if v_clinic_id is null then
    raise exception 'only admin or doctor can view reports';
  end if;

  if p_end_date < p_start_date then
    raise exception 'end date must not be before start date';
  end if;

  v_start := p_start_date::timestamptz;
  v_end := (p_end_date + 1)::timestamptz;

  return query
  select
    (
      coalesce((
        select sum(b.final_amount_paise) from public.bills b
        where b.clinic_id = v_clinic_id and b.payment_method in ('cash', 'upi')
          and b.confirmed_at >= v_start and b.confirmed_at < v_end
      ), 0)
      +
      coalesce((
        select sum(b.final_amount_paise) from public.bill_settlements s
        join public.bills b on b.id = s.bill_id
        where b.clinic_id = v_clinic_id
          and s.settled_at >= v_start and s.settled_at < v_end
      ), 0)
    )::bigint as collections_paise,
    coalesce((
      select sum(t.calc_total - t.final_amount_paise)
      from (
        select b.id, b.final_amount_paise, coalesce(sum(bli.line_total_paise), 0) as calc_total
        from public.bills b
        left join public.bill_line_items bli on bli.bill_id = b.id
        where b.clinic_id = v_clinic_id and b.confirmed_at >= v_start and b.confirmed_at < v_end
        group by b.id, b.final_amount_paise
      ) t
    ), 0)::bigint as discount_paise,
    coalesce((
      select count(*) from public.bills b
      where b.clinic_id = v_clinic_id and b.confirmed_at >= v_start and b.confirmed_at < v_end
    ), 0)::int as bill_count;
end;
$$;

revoke execute on function public.get_gst_report(date, date) from public, anon, authenticated;
grant execute on function public.get_gst_report(date, date) to authenticated;
