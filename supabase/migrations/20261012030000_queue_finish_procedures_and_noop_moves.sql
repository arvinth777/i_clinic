-- queue_visit_action follow-ups from the 2026-10-12 flow test:
--  * finish: a visit with procedures but no medicines can be finished (counselling/injection-only visits
--    were unbillable); medicines, when present, must still have a dose and duration.
--  * move_up/move_down on a patient who cannot move (already first/last) writes no note and no event.

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
      or exists(select 1 from public.prescriptions p join public.prescription_items pi on pi.prescription_id=p.id where p.visit_id=v.id and (nullif(btrim(pi.dosage_frequency),'') is null or pi.duration_days is null or pi.duration_days<=0)) then raise exception 'add a medicine (with dose and duration) or a procedure before finishing'; end if;
    if not exists(select 1 from public.visit_pricing where visit_id=v.id and final_amount_set) then raise exception 'approve the bill before finishing'; end if;
    update public.visits set stage='ready_to_bill',consultation_ended_at=event_time where id=v.id;
  elsif p_action in ('move_up','move_down') then
    if v.stage<>'waiting' then raise exception 'only waiting patients can move'; end if;
    select * into other from public.visits where clinic_id=c and stage='waiting' and (arrived_at at time zone 'Asia/Kolkata')::date=(v.arrived_at at time zone 'Asia/Kolkata')::date
      and ((p_action='move_up' and queue_position<v.queue_position) or (p_action='move_down' and queue_position>v.queue_position))
      order by case when p_action='move_up' then -queue_position else queue_position end,id limit 1 for update;
    -- Already first/last: nothing moved, so write no note and no audit event (it used to log 'moved up' anyway).
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
