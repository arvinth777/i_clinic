-- Keep prescribed quantity and approved discount alongside the actual supply.
alter table public.bill_line_items drop constraint bill_line_items_quantity_check;
alter table public.bill_line_items add constraint bill_line_items_quantity_check check(quantity>=0 and (quantity>0 or kind='medicine'));
alter table public.bill_line_items add column prescription_item_id uuid references public.prescription_items(id),
 add column approved_quantity int check(approved_quantity>0),
 add column shortfall int generated always as (coalesce(approved_quantity,quantity)-quantity) stored,
 add constraint bill_line_items_approved_cap check(approved_quantity is null or quantity<=approved_quantity);
alter table public.bills add column approved_discount_paise bigint check(approved_discount_paise>=0);

-- All dispensing paths lock the same stock row, including pharmacy sales.
-- Adjustments/counts may still record a real negative discrepancy for review.
create function public.guard_dispensing_stock() returns trigger language plpgsql security definer set search_path='' as $$
declare available int;
begin
 if not exists(select 1 from public.medicines where id=new.medicine_id and clinic_id=new.clinic_id)
   or not exists(select 1 from public.stock_points where id=new.stock_point_id and clinic_id=new.clinic_id) then raise exception 'stock references must belong to this clinic'; end if;
 if new.reason='dispensed' then
  insert into public.medicine_stock(clinic_id,medicine_id,stock_point_id,quantity) values(new.clinic_id,new.medicine_id,new.stock_point_id,0) on conflict(medicine_id,stock_point_id) do nothing;
  select quantity into available from public.medicine_stock where medicine_id=new.medicine_id and stock_point_id=new.stock_point_id for update;
  if available+new.quantity_delta<0 then raise exception 'not enough stock at this stock point; reduce supplied quantity'; end if;
 end if; return new;
end; $$;
revoke execute on function public.guard_dispensing_stock() from public,anon,authenticated;
create trigger trg_guard_dispensing_stock before insert on public.stock_movements for each row execute function public.guard_dispensing_stock();

drop function public.confirm_bill(uuid,text,bigint,bigint);
create function public.confirm_bill(p_visit_id uuid,p_payment_method text,p_snapshot_final_amount_paise bigint default null,p_snapshot_revision_number bigint default null,p_supplied_items jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.visits; a public.pricing_approvals; existing uuid; bill_id uuid; counter_id uuid; l jsonb; supplied int; subtotal bigint:=0; payable bigint; lines jsonb:='[]';
begin
 select * into v from public.visits where id=p_visit_id for update;
 if v.id is null or not public.has_clinic_role(v.clinic_id,'receptionist') then raise exception 'only reception can confirm a bill'; end if;
 select id into existing from public.bills where visit_id=v.id and corrects_bill_id is null order by confirmed_at desc limit 1;
 if existing is not null then return existing; end if;
 if v.stage<>'ready_to_bill' then raise exception 'visit is not ready for billing'; end if;
 if p_payment_method not in ('cash','upi','pay_later') or p_payment_method is null then raise exception 'invalid payment method'; end if;
 if (p_snapshot_revision_number is null)<>(p_snapshot_final_amount_paise is null) then raise exception 'amount and revision must be supplied together'; end if;
 if p_snapshot_revision_number is null then
  select pa.* into a from public.pricing_approvals pa join public.visit_pricing vp on vp.visit_id=pa.visit_id and vp.revision_number=pa.revision_number where pa.visit_id=v.id and vp.final_amount_set;
 else select * into a from public.pricing_approvals where visit_id=v.id and revision_number=p_snapshot_revision_number and final_amount_paise=p_snapshot_final_amount_paise;
 end if;
 if a.lines is null or a.discount_paise is null then raise exception 'a complete doctor-approved bill is required; ask the doctor to review'; end if;
 if p_supplied_items is not null then
  if jsonb_typeof(p_supplied_items)<>'array' then raise exception 'supplied quantities must be a list'; end if;
  if jsonb_array_length(p_supplied_items)<>(select count(*) from jsonb_array_elements(a.lines) x where x->>'kind'='medicine')
    or exists(select 1 from jsonb_array_elements(p_supplied_items) x where not exists(select 1 from jsonb_array_elements(a.lines) y where y->>'kind'='medicine' and y->>'prescription_item_id'=x->>'prescription_item_id'))
    or (select count(distinct x->>'prescription_item_id') from jsonb_array_elements(p_supplied_items) x)<>jsonb_array_length(p_supplied_items) then raise exception 'provide each approved medicine exactly once'; end if;
 end if;
 for l in select value from jsonb_array_elements(a.lines) loop
  supplied:=(l->>'quantity')::int;
  if l->>'kind'='medicine' and p_supplied_items is not null then
   select (x->>'quantity')::int into supplied from jsonb_array_elements(p_supplied_items) x where x->>'prescription_item_id'=l->>'prescription_item_id';
   if exists(select 1 from jsonb_array_elements(p_supplied_items) x where x->>'prescription_item_id'=l->>'prescription_item_id' and (x->>'quantity') !~ '^[0-9]+$') then raise exception 'supply whole stock units'; end if;
  end if;
  if supplied is null or supplied<0 or supplied>(l->>'quantity')::int then raise exception 'supply cannot exceed approved quantity'; end if;
  if l->>'unit_price_paise' is null then raise exception 'approved price missing'; end if;
  subtotal:=subtotal+supplied*(l->>'unit_price_paise')::bigint;
  lines:=lines||jsonb_build_array(l||jsonb_build_object('supplied',supplied));
 end loop;
 payable:=greatest(0,subtotal-a.discount_paise);
 select id into counter_id from public.stock_points where clinic_id=v.clinic_id and name='Counter';
 if counter_id is null and exists(select 1 from jsonb_array_elements(lines) x where x->>'kind'='medicine' and (x->>'supplied')::int>0) then raise exception 'Counter stock point required'; end if;
 -- Deterministic lock order also covers duplicate medicine lines in a prescription.
 perform 1 from public.medicine_stock s where s.stock_point_id=counter_id and s.medicine_id in (select (x->>'medicine_id')::uuid from jsonb_array_elements(lines) x where x->>'kind'='medicine') order by s.medicine_id for update;
 insert into public.bills(clinic_id,visit_id,final_amount_paise,pricing_revision_at_confirm,payment_method,confirmed_by,approved_discount_paise)
 values(v.clinic_id,v.id,payable,a.revision_number,p_payment_method,auth.uid(),a.discount_paise) returning id into bill_id;
 for l in select value from jsonb_array_elements(lines) order by value->>'medicine_id',value->>'prescription_item_id' loop
  insert into public.bill_line_items(clinic_id,bill_id,kind,procedure_id,medicine_id,description,quantity,unit_price_paise,stock_unit,prescription_item_id,approved_quantity)
  values(v.clinic_id,bill_id,l->>'kind',(l->>'procedure_id')::uuid,(l->>'medicine_id')::uuid,l->>'description',(l->>'supplied')::int,(l->>'unit_price_paise')::bigint,l->>'stock_unit',(l->>'prescription_item_id')::uuid,case when l->>'kind'='medicine' then (l->>'quantity')::int else null end);
  if l->>'kind'='medicine' and (l->>'supplied')::int>0 then
   insert into public.stock_movements(clinic_id,medicine_id,stock_point_id,quantity_delta,reason,reference_id,created_by)
   values(v.clinic_id,(l->>'medicine_id')::uuid,counter_id,-(l->>'supplied')::int,'dispensed',(l->>'prescription_item_id')::uuid,auth.uid());
  end if;
 end loop;
 update public.visits set stage='paid',closed_at=now() where id=v.id;
 return bill_id;
end; $$;
revoke execute on function public.confirm_bill(uuid,text,bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_bill(uuid,text,bigint,bigint,jsonb) to authenticated;

-- Print issued instructions from the approval paid by this bill, even after a correction.
create or replace function public.get_approved_bill(p_visit_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.visits; a public.pricing_approvals; result jsonb;
begin
 select * into v from public.visits where id=p_visit_id;
 if v.id is null or not (public.has_clinic_role(v.clinic_id,'doctor') or (public.has_clinic_role(v.clinic_id,'receptionist') and v.stage in ('ready_to_bill','paid'))) then raise exception 'issued bill access required'; end if;
 if v.stage='paid' then
  select pa.* into a from public.pricing_approvals pa join public.bills b on b.visit_id=pa.visit_id and b.pricing_revision_at_confirm=pa.revision_number where pa.visit_id=v.id and b.corrects_bill_id is null order by b.confirmed_at desc limit 1;
 else
  select pa.* into a from public.pricing_approvals pa join public.visit_pricing vp on vp.visit_id=pa.visit_id and vp.revision_number=pa.revision_number where pa.visit_id=v.id and vp.final_amount_set;
 end if;
 if a.lines is null then return null; end if;
 select jsonb_agg(l || jsonb_build_object('available_quantity',coalesce(s.quantity,0))) into result from jsonb_array_elements(a.lines) l
 left join public.stock_points sp on sp.clinic_id=v.clinic_id and sp.name='Counter'
 left join public.medicine_stock s on s.stock_point_id=sp.id and s.medicine_id=(l->>'medicine_id')::uuid;
 return jsonb_build_object('lines',result,'revision_number',a.revision_number,'final_amount_paise',a.final_amount_paise,'discount_paise',a.discount_paise);
end; $$;
revoke execute on function public.get_approved_bill(uuid) from public,anon,authenticated;
grant execute on function public.get_approved_bill(uuid) to authenticated;
