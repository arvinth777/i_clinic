-- Phase G fix pass (docs/STATUS.md, deferred item from Critical #1's own
-- fix): get_daily_report's (and, found while fixing this -- the same
-- collections SQL is literally duplicated across all three report
-- functions per this migration's own header -- get_monthly_report's and
-- get_gst_report's) collections figure summed every bill confirmed in
-- the period, including a bill that has since been corrected. A same-day
-- original-then-correction pair (or a correction landing in the same
-- month/date-range as its original) would count both amounts, inflating
-- collections beyond what's actually in the drawer.
--
-- Decided: count only the terminal bill in each correction chain, never
-- the sum -- the same "not exists a later correction" idiom
-- bills_needing_reconciliation and needs_reconciliation_count already
-- use for exactly this "is this bill still current" question. A bill
-- confirmed in the period that has since been corrected is excluded
-- (its amount no longer reflects reality); the chain's terminal bill
-- counts on whichever day *it* was confirmed, which is how a correction
-- genuinely entered today already flows into today's collections without
-- any special-casing.
--
-- Applied to all three report functions' collections computation for
-- consistency -- leaving two of three still summing naively would mean
-- the daily and monthly/GST figures could disagree for the exact same
-- underlying bills, which is a worse inconsistency than not touching
-- them. Discount and patient-count computations are untouched: this
-- fix pass's own instruction is specifically about collections/"the
-- drawer", and expanding into discount wasn't asked for.
--
-- get_daily_report also gains two new output columns
-- (corrections_today_count, corrections_today_net_paise) -- visibility
-- into today's corrections regardless of which day the correction chain
-- itself is attributed to, so a receptionist doing end-of-day
-- reconciliation can see "did anything get corrected today, and by how
-- much" even when that money doesn't appear in today's own Collections
-- line. Adding output columns to a RETURNS TABLE function needs
-- drop-then-create, not a bare CREATE OR REPLACE (Postgres rejects a
-- return-type change on OR REPLACE) -- the same class of gotcha this
-- project's own history already flags for parameter-list changes.

drop function public.get_daily_report(date);

create function public.get_daily_report(p_date date default current_date)
returns table (
  collections_paise bigint,
  patient_count int,
  discount_paise bigint,
  needs_reconciliation_count int,
  corrections_today_count int,
  corrections_today_net_paise bigint
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
          and not exists (select 1 from public.bills c where c.corrects_bill_id = b.id)
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
    ), 0)::int as needs_reconciliation_count,
    coalesce((
      select count(*) from public.bills b
      where b.clinic_id = v_clinic_id and b.corrects_bill_id is not null
        and b.confirmed_at >= v_start and b.confirmed_at < v_end
    ), 0)::int as corrections_today_count,
    coalesce((
      select sum(b.final_amount_paise - orig.final_amount_paise)
      from public.bills b
      join public.bills orig on orig.id = b.corrects_bill_id
      where b.clinic_id = v_clinic_id and b.corrects_bill_id is not null
        and b.confirmed_at >= v_start and b.confirmed_at < v_end
    ), 0)::bigint as corrections_today_net_paise;
end;
$$;

revoke execute on function public.get_daily_report(date) from public, anon, authenticated;
grant execute on function public.get_daily_report(date) to authenticated;

-- get_monthly_report and get_gst_report: same collections fix, no
-- output-column change, so a bare CREATE OR REPLACE is safe (grants
-- carry across unchanged, since the signature and return type are
-- identical to what's already applied).

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
          and not exists (select 1 from public.bills c where c.corrects_bill_id = b.id)
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
          and not exists (select 1 from public.bills c where c.corrects_bill_id = b.id)
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
