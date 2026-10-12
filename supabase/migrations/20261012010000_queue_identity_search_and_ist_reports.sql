-- Audit follow-up (2026-10-12): queue integrity, input sanity, search, report days.
--
-- 1. A visit's arrival time and token are queue identity. Staff screens only ever
--    inserted them; a raw table write could rewrite them (reception set a token to
--    999999) and a future arrived_at at the head of the queue blocked Call next for
--    the whole clinic ("invalid action time"). Inserts are clamped to the server
--    clock (offline replays keep their older client time); updates may not change
--    them, token_number, or clinic_id. auth.uid() is null for service/maintenance SQL.
-- 2. Follow-up (review) dates must be a real upcoming date.
-- 3. patients.age must be plausible. NOT VALID: new and edited rows only, existing
--    synthetic rows are left alone.
-- 4. search_patients: substring name match (typeahead), digits anywhere in the phone,
--    today's token number, trigram kept for typos.
-- 5. Report days are Indian-clinic days (Asia/Kolkata), not database-timezone days.

create or replace function public.clamp_visit_arrival() returns trigger
language plpgsql set search_path to '' as $$
begin
  if new.arrived_at > now() + interval '5 minutes' then new.arrived_at := now(); end if;
  return new;
end; $$;
drop trigger if exists trg_clamp_visit_arrival on public.visits;
create trigger trg_clamp_visit_arrival before insert on public.visits for each row execute function public.clamp_visit_arrival();

create or replace function public.guard_visit_identity() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.token_number is distinct from old.token_number or new.arrived_at is distinct from old.arrived_at
     or new.clinic_id is distinct from old.clinic_id then
    raise exception 'token number, arrival time and clinic are fixed once a visit exists';
  end if;
  return new;
end; $$;
drop trigger if exists trg_guard_visit_identity on public.visits;
create trigger trg_guard_visit_identity before update on public.visits for each row execute function public.guard_visit_identity();

create or replace function public.validate_follow_up_date() returns trigger
language plpgsql set search_path to '' as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.follow_up_date is not null and new.follow_up_date is distinct from old.follow_up_date
     and (new.follow_up_date < today or new.follow_up_date > today + 1825) then
    raise exception 'review date must be from today up to 5 years ahead';
  end if;
  return new;
end; $$;
drop trigger if exists trg_validate_follow_up_date on public.visits;
create trigger trg_validate_follow_up_date before update on public.visits for each row execute function public.validate_follow_up_date();

alter table public.patients drop constraint if exists patients_age_range;
alter table public.patients add constraint patients_age_range check (age is null or age between 0 and 120) not valid;


create or replace function public.search_patients(p_clinic_id uuid, p_query text)
returns table(id uuid, name text, age integer, gender text, phone text, address text, last_visit_at timestamp with time zone)
language sql stable set search_path to '' as $$
  with q as (
    select trim(p_query) as t,
           replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') as esc,
           regexp_replace(p_query, '\D', '', 'g') as digits,
           ((now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata') as today_start
  )
  select p.id, p.name, p.age, p.gender, p.phone, p.address,
    (select max(v.arrived_at) from public.visits v where v.patient_id = p.id) as last_visit_at
  from public.patients p, q
  where p.clinic_id = p_clinic_id and q.t <> '' and (
       p.name ilike (case when length(q.t) >= 2 then '%' else '' end) || q.esc || '%'
    or (length(q.digits) >= 3 and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || q.digits || '%')
    or (length(q.t) >= 3 and p.name operator(extensions.%) q.t)
    or (q.t ~ '^\d{1,6}$' and exists (
         select 1 from public.visits v
         where v.patient_id = p.id and v.arrived_at >= q.today_start and v.token_number = q.t::int))
  )
  order by
    (q.t ~ '^\d{1,6}$' and exists (select 1 from public.visits v where v.patient_id = p.id and v.arrived_at >= q.today_start and v.token_number = q.t::int)) desc,
    (p.name ilike q.esc || '%') desc,
    (select max(v.arrived_at) from public.visits v where v.patient_id = p.id) desc nulls last,
    extensions.similarity(p.name, q.t) desc
  limit 20;
$$;

drop function if exists public.get_daily_report(date);
CREATE OR REPLACE FUNCTION public.get_daily_report(p_date date DEFAULT ((now() at time zone 'Asia/Kolkata')::date)) RETURNS TABLE(collections_paise bigint, patient_count integer, discount_paise bigint, needs_reconciliation_count integer, corrections_today_count integer, corrections_today_net_paise bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

  v_start := p_date::timestamp at time zone 'Asia/Kolkata';
  v_end := (p_date + 1)::timestamp at time zone 'Asia/Kolkata';

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
revoke all on function public.get_daily_report(date) from public;
grant all on function public.get_daily_report(date) to service_role, authenticated;

CREATE OR REPLACE FUNCTION public.get_gst_report(p_start_date date, p_end_date date) RETURNS TABLE(collections_paise bigint, discount_paise bigint, bill_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

  v_start := p_start_date::timestamp at time zone 'Asia/Kolkata';
  v_end := (p_end_date + 1)::timestamp at time zone 'Asia/Kolkata';

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

CREATE OR REPLACE FUNCTION public.get_monthly_report(p_months integer DEFAULT 6) RETURNS TABLE(month_start date, collections_paise bigint, patient_count integer, discount_paise bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
    select date_trunc('month', (now() at time zone 'Asia/Kolkata')::date - (n || ' months')::interval)::date as month_start
    from generate_series(0, p_months - 1) as n
  )
  select
    mo.month_start,
    (
      coalesce((
        select sum(b.final_amount_paise) from public.bills b
        where b.clinic_id = v_clinic_id and b.payment_method in ('cash', 'upi')
          and b.confirmed_at >= (mo.month_start::timestamp at time zone 'Asia/Kolkata') and b.confirmed_at < ((mo.month_start + interval '1 month')::timestamp at time zone 'Asia/Kolkata')
          and not exists (select 1 from public.bills c where c.corrects_bill_id = b.id)
      ), 0)
      +
      coalesce((
        select sum(b.final_amount_paise) from public.bill_settlements s
        join public.bills b on b.id = s.bill_id
        where b.clinic_id = v_clinic_id
          and s.settled_at >= (mo.month_start::timestamp at time zone 'Asia/Kolkata') and s.settled_at < ((mo.month_start + interval '1 month')::timestamp at time zone 'Asia/Kolkata')
      ), 0)
    )::bigint as collections_paise,
    coalesce((
      select count(distinct v.patient_id) from public.visits v
      where v.clinic_id = v_clinic_id and v.arrived_at >= (mo.month_start::timestamp at time zone 'Asia/Kolkata') and v.arrived_at < ((mo.month_start + interval '1 month')::timestamp at time zone 'Asia/Kolkata')
    ), 0)::int as patient_count,
    coalesce((
      select sum(t.calc_total - t.final_amount_paise)
      from (
        select b.id, b.final_amount_paise, coalesce(sum(bli.line_total_paise), 0) as calc_total
        from public.bills b
        left join public.bill_line_items bli on bli.bill_id = b.id
        where b.clinic_id = v_clinic_id and b.confirmed_at >= (mo.month_start::timestamp at time zone 'Asia/Kolkata') and b.confirmed_at < ((mo.month_start + interval '1 month')::timestamp at time zone 'Asia/Kolkata')
          and (b.pharmacy_sale_id is null or not exists (select 1 from public.bills c where c.corrects_bill_id = b.id))
        group by b.id, b.final_amount_paise
      ) t
    ), 0)::bigint as discount_paise
  from months mo
  order by mo.month_start;
end;
$$;
