-- Release blockers found in review of the reception brand-billing release (PR #57):
--  * a visit with procedures but no medicines could no longer be finished, archived or billed;
--  * moving a patient who is already first/last wrote a note and event again;
--  * the supplied <= prescribed cap was skipped when the prescribed quantity was NULL;
--  * the stock-unit match was case-sensitive ('tablet' vs 'Tablet').
-- The idle screen lock is removed completely (its column and function from 20261017070000 go).

CREATE OR REPLACE FUNCTION public.queue_visit_action(p_visit_id uuid, p_action text, p_request_id uuid, p_reason text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v public.visits; other public.visits; c uuid; e public.queue_events; payload jsonb; event_time timestamptz; today date; threshold int; target_stage text;
begin
  select clinic_id into c from public.visits where id=p_visit_id;
  if c is null or not (public.has_clinic_role(c,'doctor') or public.has_clinic_role(c,'receptionist')) then raise exception 'clinic staff required'; end if;
  if p_request_id is null or p_action not in ('call','sent_in','finish','move_up','move_down','not_here','return_original','return_end','no_show') then raise exception 'invalid queue action'; end if;
  if p_action in ('call','finish') and not public.has_clinic_role(c,'doctor') then raise exception 'doctor action'; end if;
  if p_action not in ('call','finish') and not public.has_clinic_role(c,'receptionist') then raise exception 'reception action'; end if;
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
  if v.stage in ('paid','no_show') then raise exception 'closed visit; check in again for a new token'; end if;
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

create or replace function public.confirm_reception_bill(
  p_visit_id uuid, p_payment_method text, p_expected_total_paise bigint, p_items jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v public.visits; existing uuid; result uuid; counter_id uuid;
  pi public.prescription_items; prescribed public.medicines; chosen public.medicines;
  item jsonb; supplied int; subtotal bigint; rx_count int; revision bigint;
begin
  select * into v from public.visits where id = p_visit_id for update;
  if v.id is null or not public.has_clinic_role(v.clinic_id, 'receptionist') then raise exception 'reception required'; end if;
  select id into existing from public.bills where visit_id = v.id and corrects_bill_id is null order by confirmed_at desc limit 1;
  if existing is not null then return existing; end if;
  if v.stage <> 'ready_to_bill' then raise exception 'visit not ready to bill'; end if;
  if p_payment_method not in ('cash', 'upi', 'pay_later') or p_payment_method is null then raise exception 'invalid payment method'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'supply every prescribed item'; end if;
  select count(*) into rx_count from public.prescription_items pi
    join public.prescriptions p on p.id = pi.prescription_id where p.visit_id = v.id;
  if jsonb_array_length(p_items) <> rx_count or
     (select count(distinct x->>'prescription_item_id') from jsonb_array_elements(p_items) x) <> rx_count then
    raise exception 'supply every prescribed item exactly once';
  end if;
  select id into counter_id from public.stock_points where clinic_id = v.clinic_id and name = 'Counter';
  if counter_id is null then raise exception 'Counter stock point required'; end if;
  -- Price changes lock the same catalog rows. Stock movement triggers enforce
  -- non-negative stock, and the visit lock makes retries return one bill.
  perform 1 from public.medicines m where m.id in (
    select (x->>'medicine_id')::uuid from jsonb_array_elements(p_items) x
  ) order by m.id for share;
  perform 1 from public.medicine_stock s where s.stock_point_id = counter_id and s.medicine_id in (
    select (x->>'medicine_id')::uuid from jsonb_array_elements(p_items) x
  ) order by s.medicine_id for update;
  select coalesce(sum(vp.price_paise), 0) into subtotal from public.visit_procedures vp where vp.visit_id = v.id;
  subtotal := subtotal + v.consultation_charge_paise;
  for pi in select pi.* from public.prescription_items pi
      join public.prescriptions p on p.id = pi.prescription_id where p.visit_id = v.id order by pi.id loop
    select x into item from jsonb_array_elements(p_items) x where x->>'prescription_item_id' = pi.id::text;
    if item is null then raise exception 'missing prescribed item'; end if;
    if item->>'quantity' !~ '^[0-9]+$' then raise exception 'supply whole stock units'; end if;
    supplied := (item->>'quantity')::int;
    if supplied > coalesce(pi.quantity_dispensed, 0) then raise exception 'cannot supply more than prescribed'; end if;
    select * into prescribed from public.medicines where id = pi.medicine_id;
    select * into chosen from public.medicines where id = (item->>'medicine_id')::uuid and clinic_id = v.clinic_id;
    if chosen.id is null or not chosen.is_active or chosen.unit_confirmed_at is null then raise exception 'choose an active medicine with a confirmed unit and price'; end if;
    if lower(btrim(pi.molecule_name)) <>
       lower(btrim(coalesce(nullif(chosen.molecule_name, ''), chosen.name))) or
       (chosen.id <> prescribed.id and (pi.strength is null or not exists (
         select 1 from unnest(chosen.strength_options) s where lower(btrim(s)) = lower(btrim(pi.strength))
       ))) or
       (chosen.id = prescribed.id and cardinality(chosen.strength_options) > 0 and
         not exists (select 1 from unnest(chosen.strength_options) s where lower(btrim(s)) = lower(btrim(pi.strength))))
    then raise exception 'brand must match prescribed molecule and strength'; end if;
    if (item->>'unit_price_paise')::bigint is distinct from chosen.price_paise or
       lower(btrim(coalesce(item->>'stock_unit', ''))) is distinct from lower(btrim(coalesce(chosen.stock_unit, ''))) or
       lower(btrim(coalesce(pi.stock_unit, ''))) is distinct from lower(btrim(coalesce(chosen.stock_unit, ''))) then
      raise exception 'catalog price or unit changed; refresh the bill';
    end if;
    subtotal := subtotal + supplied::bigint * chosen.price_paise;
  end loop;
  if p_expected_total_paise is distinct from subtotal then raise exception 'bill changed; refresh before payment'; end if;
  select revision_number into revision from public.visit_pricing where visit_id = v.id;
  insert into public.bills(clinic_id, visit_id, final_amount_paise, pricing_revision_at_confirm, payment_method, confirmed_by, approved_discount_paise)
  values(v.clinic_id, v.id, subtotal, revision, p_payment_method, auth.uid(), 0) returning id into result;
  insert into public.bill_line_items(clinic_id,bill_id,kind,description,quantity,unit_price_paise)
  values(v.clinic_id,result,'consultation','Consultation',1,v.consultation_charge_paise);
  insert into public.bill_line_items(clinic_id,bill_id,kind,procedure_id,description,quantity,unit_price_paise)
  select v.clinic_id,result,'procedure',vp.procedure_id,p.name,1,vp.price_paise
  from public.visit_procedures vp join public.procedures p on p.id = vp.procedure_id where vp.visit_id = v.id;
  for pi in select pi.* from public.prescription_items pi
      join public.prescriptions p on p.id = pi.prescription_id where p.visit_id = v.id order by pi.id loop
    select x into item from jsonb_array_elements(p_items) x where x->>'prescription_item_id' = pi.id::text;
    supplied := (item->>'quantity')::int;
    select * into chosen from public.medicines where id = (item->>'medicine_id')::uuid;
    insert into public.bill_line_items(clinic_id,bill_id,kind,medicine_id,description,quantity,unit_price_paise,stock_unit,prescription_item_id,approved_quantity)
    values(v.clinic_id,result,'medicine',chosen.id,chosen.name,supplied,chosen.price_paise,chosen.stock_unit,pi.id,pi.quantity_dispensed);
    if supplied > 0 then
      insert into public.stock_movements(clinic_id,medicine_id,stock_point_id,quantity_delta,reason,reference_id,created_by)
      values(v.clinic_id,chosen.id,counter_id,-supplied,'dispensed',pi.id,auth.uid());
    end if;
  end loop;
  update public.visits set stage = 'paid', closed_at = now() where id = v.id;
  return result;
end;
$$;
revoke execute on function public.confirm_reception_bill(uuid,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_reception_bill(uuid,text,bigint,jsonb) to authenticated;

create or replace function public.enqueue_prescription_archive()
returns trigger language plpgsql security definer set search_path = '' as $$
declare medicines jsonb; version bigint;
begin
  if new.stage = 'ready_to_bill' and old.stage is distinct from new.stage then
    select coalesce(jsonb_agg(jsonb_build_object(
      'kind', 'medicine', 'description', pi.molecule_name,
      'strength', pi.strength, 'drug_type', pi.drug_type,
      'before_after_food', pi.before_after_food, 'dosage_frequency', pi.dosage_frequency,
      'duration_days', pi.duration_days, 'notes', pi.notes,
      'quantity', pi.quantity_dispensed, 'stock_unit', pi.stock_unit,
      'unit_price_paise', 0) order by pi.created_at, pi.id), '[]'::jsonb),
      (select revision_number from public.visit_pricing where visit_id = new.id)
    into medicines, version
    from public.prescriptions p join public.prescription_items pi on pi.prescription_id = p.id
    join public.medicines m on m.id = pi.medicine_id where p.visit_id = new.id;
    -- A procedure-only visit has no medicines; its prescription archive lists none.
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

drop function public.set_idle_lock(uuid, boolean);
alter table public.clinics drop column idle_lock_enabled;
