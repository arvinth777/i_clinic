alter table public.visits add column discount_requested_at timestamptz;
create function public.request_bill_discount(p_visit_id uuid,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.visits; e public.queue_events;
begin
 select * into v from public.visits where id=p_visit_id for update;
 if v.id is null or not public.has_clinic_role(v.clinic_id,'receptionist') then raise exception 'reception required'; end if;
 if p_request_id is null then raise exception 'request ID required'; end if;
 select * into e from public.queue_events where request_id=p_request_id;
 if found then
  if e.actor_id<>auth.uid() or e.visit_id<>v.id or e.action<>'request_discount' then raise exception 'request ID already used'; end if;
  return v.id;
 end if;
 if v.stage<>'ready_to_bill' then raise exception 'request a discount on an unpaid issued bill'; end if;
 perform set_config('app.queue_command','true',true);
 update public.visits set discount_requested_at=now() where id=v.id;
 perform set_config('app.queue_command','false',true);
 insert into public.queue_events(request_id,clinic_id,visit_id,actor_id,action,occurred_at,payload,resulting_stage)
 values(p_request_id,v.clinic_id,v.id,auth.uid(),'request_discount',now(),jsonb_build_object('visit',v.id),'ready_to_bill');
 return v.id;
end; $$;
revoke execute on function public.request_bill_discount(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_bill_discount(uuid,uuid) to authenticated;

-- Keep requests behind the same command boundary, and acknowledge only a fresh approval.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.guard_queue_write()'::regprocedure);
 definition:=replace(definition,'if new.stage=''paid'' and exists','if new.stage=''paid'' and new.discount_requested_at is not distinct from old.discount_requested_at and exists');
 definition:=replace(definition,'if new.stage is distinct from old.stage','if new.discount_requested_at is distinct from old.discount_requested_at or new.stage is distinct from old.stage');
 execute definition;
 definition:=pg_get_functiondef('public.approve_visit_pricing(uuid,bigint,bigint,bigint,uuid)'::regprocedure);
 definition:=replace(definition,' return revision;',E' perform set_config(''app.queue_command'',''true'',true);\n update public.visits set discount_requested_at=null where id=p_visit_id;\n perform set_config(''app.queue_command'',''false'',true);\n return revision;');
 execute definition;
end $$;

-- Corrections change the doctor's discount, never quantities already handed out.
create or replace function public.correct_bill(p_bill_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.bills; p public.visit_pricing; subtotal bigint; discount bigint; result uuid;
begin
 select * into b from public.bills where id=p_bill_id for update;
 if b.id is null or b.visit_id is null or not public.has_clinic_role(b.clinic_id,'doctor') then raise exception 'doctor and consultation bill required'; end if;
 if exists(select 1 from public.bills where corrects_bill_id=b.id) then raise exception 'bill already corrected'; end if;
 select * into p from public.visit_pricing where visit_id=b.visit_id for update;
 if not p.final_amount_set then raise exception 'doctor approval required'; end if;
 select sum(line_total_paise) into subtotal from public.bill_line_items where bill_id=b.id;
 if subtotal is null then raise exception 'original receipt lines unavailable; review this legacy bill'; end if;
 discount:=p.calculated_total_paise-p.final_amount_paise;
 insert into public.bills(clinic_id,visit_id,final_amount_paise,pricing_revision_at_confirm,payment_method,confirmed_by,corrects_bill_id,approved_discount_paise)
 values(b.clinic_id,b.visit_id,greatest(0,subtotal-discount),p.revision_number,b.payment_method,auth.uid(),b.id,discount) returning id into result;
 insert into public.bill_line_items(clinic_id,bill_id,kind,procedure_id,medicine_id,description,quantity,unit_price_paise,stock_unit,prescription_item_id,approved_quantity)
 select clinic_id,result,kind,procedure_id,medicine_id,description,quantity,unit_price_paise,stock_unit,prescription_item_id,approved_quantity from public.bill_line_items where bill_id=b.id;
 return result;
end; $$;
revoke execute on function public.correct_bill(uuid) from public,anon,authenticated;
grant execute on function public.correct_bill(uuid) to authenticated;
