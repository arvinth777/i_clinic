-- Queue commands serialize per clinic; arrival and token remain immutable facts.
alter table public.clinics add column no_show_minutes int not null default 30 check (no_show_minutes between 1 and 240);
alter table public.visits
  add column queue_position bigint,
  add column called_at timestamptz,
  add column sent_in_at timestamptz,
  add column not_here_at timestamptz,
  add column queue_note text;
with ranked as (select id, row_number() over (partition by clinic_id, (arrived_at at time zone 'Asia/Kolkata')::date order by arrived_at,id) * 1024 as pos from public.visits)
update public.visits v set queue_position=r.pos from ranked r where r.id=v.id;
alter table public.visits alter column queue_position set not null;
drop trigger trg_ensure_final_amount_set_on_packing on public.visits;
alter table public.visits drop constraint visits_stage_check;
update public.visits set stage='ready_to_bill' where stage in ('packing','ready_at_reception');
alter table public.visits add constraint visits_stage_check check (stage in ('waiting','called','with_doctor','ready_to_bill','paid','not_here','no_show'));

create table public.queue_events (
  request_id uuid primary key,
  clinic_id uuid not null references public.clinics(id),
  visit_id uuid not null references public.visits(id),
  actor_id uuid not null references auth.users(id),
  action text not null,
  reason text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  payload jsonb not null,
  resulting_stage text not null
);
alter table public.queue_events enable row level security;
create policy queue_events_read on public.queue_events for select using (public.has_clinic_role(clinic_id,'doctor') or public.has_clinic_role(clinic_id,'receptionist'));
revoke all on public.queue_events from anon, authenticated;
grant select on public.queue_events to authenticated;

create function public.initialize_queue_position() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and new.stage <> 'waiting' then raise exception 'check in as waiting'; end if;
  perform 1 from public.clinics where id=new.clinic_id for update;
  select coalesce(max(queue_position),0)+1024 into new.queue_position from public.visits
    where clinic_id=new.clinic_id and (arrived_at at time zone 'Asia/Kolkata')::date=(new.arrived_at at time zone 'Asia/Kolkata')::date;
  new.called_at:=null; new.sent_in_at:=null; new.not_here_at:=null; new.queue_note:=null;
  return new;
end; $$;
revoke execute on function public.initialize_queue_position() from public,anon,authenticated;
create trigger trg_initialize_queue_position before insert on public.visits for each row execute function public.initialize_queue_position();

create function public.guard_queue_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if coalesce(current_setting('app.queue_command',true),'')='true' then return new; end if;
  -- Payment is authored by the atomic billing RPC, after its immutable bill insert.
  if new.stage='paid' and exists(select 1 from public.bills where visit_id=new.id) then return new; end if;
  if new.stage is distinct from old.stage or new.queue_position is distinct from old.queue_position
     or new.called_at is distinct from old.called_at or new.sent_in_at is distinct from old.sent_in_at
     or new.not_here_at is distinct from old.not_here_at or new.queue_note is distinct from old.queue_note then
    raise exception 'use queue actions; older pending stage changes require review in the updated app';
  end if;
  return new;
end; $$;
revoke execute on function public.guard_queue_write() from public,anon,authenticated;
create trigger trg_guard_queue_write before update on public.visits for each row execute function public.guard_queue_write();

create function public.queue_visit_action(p_visit_id uuid,p_action text,p_request_id uuid,p_reason text default null,p_occurred_at timestamptz default null)
returns uuid language plpgsql security definer set search_path='' as $$
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
    if not exists(select 1 from public.prescriptions p join public.prescription_items pi on pi.prescription_id=p.id where p.visit_id=v.id)
      or exists(select 1 from public.prescriptions p join public.prescription_items pi on pi.prescription_id=p.id where p.visit_id=v.id and (nullif(btrim(pi.dosage_frequency),'') is null or pi.duration_days is null or pi.duration_days<=0)) then raise exception 'medicine, dose or SOS, and duration required'; end if;
    if not exists(select 1 from public.visit_pricing where visit_id=v.id and final_amount_set) then raise exception 'approve the bill before finishing'; end if;
    update public.visits set stage='ready_to_bill',consultation_ended_at=event_time where id=v.id;
  elsif p_action in ('move_up','move_down') then
    if v.stage<>'waiting' then raise exception 'only waiting patients can move'; end if;
    select * into other from public.visits where clinic_id=c and stage='waiting' and (arrived_at at time zone 'Asia/Kolkata')::date=(v.arrived_at at time zone 'Asia/Kolkata')::date
      and ((p_action='move_up' and queue_position<v.queue_position) or (p_action='move_down' and queue_position>v.queue_position))
      order by case when p_action='move_up' then -queue_position else queue_position end,id limit 1 for update;
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
revoke execute on function public.queue_visit_action(uuid,text,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.queue_visit_action(uuid,text,uuid,text,timestamptz) to authenticated;

create function public.set_no_show_minutes(p_clinic_id uuid,p_minutes int) returns void language plpgsql security definer set search_path='' as $$
begin
  if not (public.has_clinic_role(p_clinic_id,'doctor') or public.has_clinic_role(p_clinic_id,'admin')) then raise exception 'doctor or administrator required'; end if;
  if p_minutes is null or p_minutes not between 1 and 240 then raise exception 'use 1 to 240 minutes'; end if;
  update public.clinics set no_show_minutes=p_minutes where id=p_clinic_id;
end; $$;
revoke execute on function public.set_no_show_minutes(uuid,int) from public,anon,authenticated;
grant execute on function public.set_no_show_minutes(uuid,int) to authenticated;

-- These two existing reads/writes retain their role checks and signature.
do $$ declare f regprocedure; definition text; begin
 foreach f in array array['public.confirm_bill(uuid,text,bigint,bigint)'::regprocedure,'public.get_visit_billing_detail(uuid)'::regprocedure] loop
  definition:=pg_get_functiondef(f);
  execute replace(definition,'''ready_at_reception''','''ready_to_bill''');
 end loop;
end $$;
