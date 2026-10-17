-- Cancel visit: either the doctor or the receptionist can close any unpaid visit with a reason (left without treatment,
-- registered by mistake...). No bill, no stock change; the reason is kept in the queue history. Cancelled visits are not
-- counted as patients in the reports.
alter table public.visits drop constraint visits_stage_check;
alter table public.visits add constraint visits_stage_check
  check (stage = any (array['waiting','called','with_doctor','ready_to_bill','paid','not_here','no_show','cancelled']));

CREATE OR REPLACE FUNCTION public.queue_visit_action(p_visit_id uuid, p_action text, p_request_id uuid, p_reason text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v public.visits; other public.visits; c uuid; e public.queue_events; payload jsonb; event_time timestamptz; today date; threshold int; target_stage text;
begin
  select clinic_id into c from public.visits where id=p_visit_id;
  if c is null or not (public.has_clinic_role(c,'doctor') or public.has_clinic_role(c,'receptionist')) then raise exception 'clinic staff required'; end if;
  if p_request_id is null or p_action not in ('call','sent_in','finish','move_up','move_down','not_here','return_original','return_end','no_show','cancel') then raise exception 'invalid queue action'; end if;
  if p_action in ('call','finish') and not public.has_clinic_role(c,'doctor') then raise exception 'doctor action'; end if;
  if p_action not in ('call','finish','cancel') and not public.has_clinic_role(c,'receptionist') then raise exception 'reception action'; end if;
  if length(coalesce(p_reason,''))>500 then raise exception 'reason too long'; end if;
  select no_show_minutes into threshold from public.clinics where id=c for update;
  payload:=jsonb_build_object('visit',p_visit_id,'action',p_action,'reason',p_reason,'time',p_occurred_at);
  select * into e from public.queue_events where request_id=p_request_id;
  if found then
    if e.actor_id<>auth.uid() or e.payload<>payload then raise exception 'request already used for another action'; end if;
    return e.visit_id;
  end if;
  select * into v from public.visits where id=p_visit_id for update;
  event_time:=coalesce(p_occurred_at,now()); today:=(now() at time zone 'Asia/Kolkata')::date;
  if event_time>now()+interval '5 minutes' or event_time<v.arrived_at then raise exception 'invalid action time'; end if;
  if v.stage in ('paid','no_show','cancelled') then raise exception 'closed visit; check in again for a new token'; end if;
  perform set_config('app.queue_command','true',true);
  if p_action='call' then
    if v.stage<>'waiting' or (v.arrived_at at time zone 'Asia/Kolkata')::date<>today then raise exception 'call a waiting patient from today'; end if;
    if exists(select 1 from public.visits where clinic_id=c and (arrived_at at time zone 'Asia/Kolkata')::date=today and stage in ('called','with_doctor')) then raise exception 'finish the current consultation before calling next'; end if;
    select * into other from public.visits where clinic_id=c and stage='waiting' and (arrived_at at time zone 'Asia/Kolkata')::date=today order by queue_position,id limit 1;
    if other.id<>v.id then raise exception 'queue changed; refresh before calling next'; end if;
    update public.visits set stage='called',called_at=event_time,sent_in_at=null,with_doctor_at=null where id=v.id;
  elsif p_action='sent_in' then
    if v.stage<>'called' or event_time<v.called_at then raise exception 'patient must be called first'; end if;
    update public.visits set stage='with_doctor',sent_in_at=event_time,with_doctor_at=event_time where id=v.id;
  elsif p_action='finish' then
    if v.stage<>'with_doctor' then raise exception 'patient must be with doctor'; end if;
    -- A visit may finish on medicines (all complete) or on procedures alone (injection, dressing, counselling entered as a procedure).
    if (not exists(select 1 from public.prescriptions p join public.prescription_items pi on pi.prescription_id=p.id where p.visit_id=v.id)
         and not exists(select 1 from public.visit_procedures vp where vp.visit_id=v.id))
      or exists(select 1 from public.prescriptions p join public.prescription_items pi on pi.prescription_id=p.id where p.visit_id=v.id and (nullif(btrim(pi.dosage_frequency),'') is null or pi.duration_days is null or pi.duration_days<=0)) then raise exception 'medicine, dose or SOS, and duration required'; end if;
    update public.visits set stage='ready_to_bill',consultation_ended_at=event_time where id=v.id;
  elsif p_action in ('move_up','move_down') then
    if v.stage<>'waiting' then raise exception 'only waiting patients can move'; end if;
    select * into other from public.visits where clinic_id=c and stage='waiting' and (arrived_at at time zone 'Asia/Kolkata')::date=(v.arrived_at at time zone 'Asia/Kolkata')::date
      and ((p_action='move_up' and queue_position<v.queue_position) or (p_action='move_down' and queue_position>v.queue_position))
      order by case when p_action='move_up' then -queue_position else queue_position end,id limit 1 for update;
    -- Already first/last: nothing moved, so write no note and no audit event.
    if other.id is null then perform set_config('app.queue_command','false',true); return v.id; end if;
    if other.id is not null then
      update public.visits set queue_position=v.queue_position where id=other.id;
      update public.visits set queue_position=other.queue_position where id=v.id;
    end if;
    update public.visits set queue_note=case when p_action='move_up' then 'moved up by reception' else 'moved down by reception' end || case when nullif(btrim(p_reason),'') is not null then ' · '||btrim(p_reason) else '' end where id=v.id;
  elsif p_action='not_here' then
    if v.stage not in ('waiting','called') or event_time<coalesce(v.called_at,v.arrived_at) then raise exception 'mark a waiting or called patient not here'; end if;
    update public.visits set stage='not_here',not_here_at=event_time where id=v.id;
  elsif p_action in ('return_original','return_end') then
    if v.stage<>'not_here' then raise exception 'patient is not marked absent'; end if;
    if (v.arrived_at at time zone 'Asia/Kolkata')::date<>today then raise exception 'check in again for a new day'; end if;
    update public.visits set stage='waiting',called_at=null,sent_in_at=null,not_here_at=null,
      queue_position=case when p_action='return_end' then (select coalesce(max(queue_position),0)+1024 from public.visits where clinic_id=c and (arrived_at at time zone 'Asia/Kolkata')::date=today) else queue_position end where id=v.id;
  elsif p_action='cancel' then
    -- Either role may cancel any unpaid visit; the reason is required and stays in the queue history.
    if nullif(btrim(p_reason),'') is null then raise exception 'say why the visit is cancelled'; end if;
    update public.visits set stage='cancelled',closed_at=event_time where id=v.id;
  elsif p_action='no_show' then
    if not ((v.stage='not_here' and now()>=v.not_here_at+make_interval(mins=>threshold)) or (v.stage in ('waiting','called','with_doctor') and (v.arrived_at at time zone 'Asia/Kolkata')::date<today)) then raise exception 'no-show time has not passed'; end if;
    update public.visits set stage='no_show',closed_at=event_time where id=v.id;
  end if;
  select stage into target_stage from public.visits where id=v.id;
  insert into public.queue_events(request_id,clinic_id,visit_id,actor_id,action,reason,occurred_at,payload,resulting_stage)
    values(p_request_id,c,v.id,auth.uid(),p_action,p_reason,event_time,payload,target_stage);
  perform set_config('app.queue_command','false',true);
  return v.id;
end; $$;

revoke execute on function public.queue_visit_action(uuid,text,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.queue_visit_action(uuid,text,uuid,text,timestamptz) to authenticated;

create or replace function public.guard_visit_consultation_charge()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.consultation_charge_paise is distinct from old.consultation_charge_paise and (
    old.stage in ('paid', 'no_show', 'cancelled') or not public.has_clinic_role(old.clinic_id, 'doctor')
  ) then raise exception 'only the doctor can change an open consultation charge'; end if;
  return new;
end;
$$;

create or replace function public.set_consultation_charge(p_visit_id uuid, p_fee_paise bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.visits;
begin
  select * into v from public.visits where id = p_visit_id for update;
  if v.id is null or not public.has_clinic_role(v.clinic_id, 'doctor') then raise exception 'doctor required'; end if;
  if v.stage in ('paid', 'no_show', 'cancelled') or p_fee_paise is null or p_fee_paise < 0 then raise exception 'invalid consultation charge'; end if;
  update public.visits set consultation_charge_paise = p_fee_paise where id = p_visit_id;
end;
$$;

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
      where v.clinic_id = v_clinic_id and v.stage <> 'cancelled' and v.arrived_at >= v_start and v.arrived_at < v_end
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
      where v.clinic_id = v_clinic_id and v.stage <> 'cancelled' and v.arrived_at >= (mo.month_start::timestamp at time zone 'Asia/Kolkata') and v.arrived_at < ((mo.month_start + interval '1 month')::timestamp at time zone 'Asia/Kolkata')
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
