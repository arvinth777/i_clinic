create or replace function public.get_daily_report(p_date date default current_date)
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
          and (b.pharmacy_sale_id is null or not exists (select 1 from public.bills c where c.corrects_bill_id = b.id))
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
          and (b.pharmacy_sale_id is null or not exists (select 1 from public.bills c where c.corrects_bill_id = b.id))
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
          and (b.pharmacy_sale_id is null or not exists (select 1 from public.bills c where c.corrects_bill_id = b.id))
        group by b.id, b.final_amount_paise
      ) t
    ), 0)::bigint as discount_paise,
    coalesce((
      select count(*) from public.bills b
      where b.clinic_id = v_clinic_id and b.confirmed_at >= v_start and b.confirmed_at < v_end
    ), 0)::int as bill_count;
end;
$$;

alter publication supabase_realtime add table public.pharmacy_sales;
