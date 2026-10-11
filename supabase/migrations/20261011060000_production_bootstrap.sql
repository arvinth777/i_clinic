-- Schema-only bootstrap from verified staging at bccb6e2, through 20261010224000.
-- Historical staging fixtures remain immutable and are deliberately not replayed.
-- Existing installations are untouched; partial installations fail rather than merge.
do $bootstrap$
begin
 if to_regclass('public.patients') is not null then
  if to_regprocedure('public.correct_bill(uuid,bigint)') is null or exists(
   select 1 from unnest(array['bill_line_items','bill_settlements','bills','patients','visit_pricing','visits','clinic_documents','clinics','medicine_price_changes','medicine_stock','medicines','patient_comments','patient_field_definitions','pharma_rep_checkins','pharmacy_sale_items','pharmacy_sales','prescription_items','prescription_template_items','prescription_templates','prescriptions','pricing_approvals','procedures','purchase_items','purchases','queue_events','stock_count_lines','stock_counts','stock_movements','stock_points','suppliers','user_roles','visit_procedures']) expected(name)
   left join pg_catalog.pg_class c on c.oid=to_regclass('public.'||expected.name)
   where c.oid is null or not c.relrowsecurity
  ) then
   raise exception 'Existing app schema must be migrated before the bootstrap checkpoint';
  end if;
  return;
 end if;
 if exists(select 1 from pg_catalog.pg_tables where schemaname='public') then
  raise exception 'Production bootstrap requires an empty public schema';
 end if;
 if not exists(select 1 from pg_catalog.pg_roles where rolname='backup_reader') then
  create role backup_reader with login nosuperuser nocreatedb nocreaterole noinherit;
 end if;
 create schema if not exists extensions;
 create extension if not exists pg_trgm with schema extensions;
 grant usage on schema extensions to anon, authenticated, service_role;
 set local check_function_bodies = false;
 execute $clinic_schema$

CREATE SCHEMA IF NOT EXISTS public;

COMMENT ON SCHEMA public IS 'standard public schema';

CREATE OR REPLACE FUNCTION public.adjust_stock(p_clinic_id uuid, p_medicine_id uuid, p_stock_point_id uuid, p_quantity_delta integer, p_reason text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_id uuid;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'an adjustment needs a reason';
  end if;
  if p_quantity_delta = 0 then
    raise exception 'an adjustment must change the quantity';
  end if;

  insert into public.stock_movements (clinic_id, medicine_id, stock_point_id, quantity_delta, reason, notes, created_by)
  values (p_clinic_id, p_medicine_id, p_stock_point_id, p_quantity_delta, 'adjustment', p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_clinic_contact_info(p_clinic_id uuid, p_address text, p_phone text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.has_clinic_role(p_clinic_id, 'admin') then
    raise exception 'only admin can configure the clinic contact info';
  end if;

  update public.clinics
  set address = nullif(trim(p_address), ''),
      phone = nullif(trim(p_phone), '')
  where id = p_clinic_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_clinic_doctor_info(p_clinic_id uuid, p_doctor_name text, p_doctor_registration_number text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.has_clinic_role(p_clinic_id, 'admin') then
    raise exception 'only admin can configure the clinic doctor info';
  end if;

  update public.clinics
  set doctor_name = nullif(trim(p_doctor_name), ''),
      doctor_registration_number = nullif(trim(p_doctor_registration_number), '')
  where id = p_clinic_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_clinic_fee(p_clinic_id uuid, p_fee_paise bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.has_clinic_role(p_clinic_id, 'admin') then
    raise exception 'only admin can configure the consultation fee';
  end if;

  if p_fee_paise < 0 then
    raise exception 'consultation fee cannot be negative';
  end if;

  update public.clinics
  set consultation_fee_paise = p_fee_paise
  where id = p_clinic_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_clinic_upi_vpa(p_clinic_id uuid, p_upi_vpa text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.has_clinic_role(p_clinic_id, 'admin') then
    raise exception 'only admin can configure the clinic UPI VPA';
  end if;

  update public.clinics
  set upi_vpa = nullif(trim(p_upi_vpa), '')
  where id = p_clinic_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.apply_stock_movement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.medicine_stock (clinic_id, medicine_id, stock_point_id, quantity)
  values (new.clinic_id, new.medicine_id, new.stock_point_id, new.quantity_delta)
  on conflict (medicine_id, stock_point_id)
  do update set quantity = public.medicine_stock.quantity + excluded.quantity, updated_at = now();
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.approval_financial_lines(p_lines jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 select coalesce(jsonb_agg(line order by line::text),'[]'::jsonb) from (
  select jsonb_build_object('kind',l->'kind','prescription_item_id',l->'prescription_item_id',
   'visit_procedure_id',l->'visit_procedure_id','procedure_id',l->'procedure_id','medicine_id',l->'medicine_id','quantity',l->'quantity',
   'stock_unit',l->'stock_unit','unit_price_paise',l->'unit_price_paise') line
  from jsonb_array_elements(p_lines) l
 ) rows
$$;

CREATE OR REPLACE FUNCTION public.approve_visit_pricing(p_visit_id uuid, p_final_amount_paise bigint, p_expected_total_paise bigint, p_expected_revision_number bigint, p_request_id uuid, p_expected_lines jsonb DEFAULT NULL::jsonb) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare c uuid; proposal jsonb; existing public.pricing_approvals; revision bigint; payload jsonb;
begin
 select clinic_id into c from public.visits where id=p_visit_id for update;
 if c is null or not public.has_clinic_role(c,'doctor') then raise exception 'doctor required'; end if;
 if p_request_id is null then raise exception 'request ID required'; end if;
 payload:=jsonb_build_object('visit',p_visit_id,'final',p_final_amount_paise,'total',p_expected_total_paise,'revision',p_expected_revision_number,'lines',p_expected_lines);
 select * into existing from public.pricing_approvals where request_id=p_request_id;
 if found then
  if existing.approved_by<>auth.uid() or existing.request_payload<>payload then raise exception 'request ID already used'; end if;
  return existing.revision_number;
 end if;
 if exists(select 1 from public.visits where id=p_visit_id and stage in ('paid','no_show')) then raise exception 'use the correction workflow for a closed bill'; end if;
 perform 1 from public.visit_pricing where visit_id=p_visit_id for update;
 proposal:=public.get_pricing_proposal(p_visit_id);
 if p_expected_total_paise is distinct from (proposal->>'total_paise')::bigint or (p_expected_lines is null and p_expected_revision_number is distinct from (proposal->>'revision_number')::bigint) or (p_expected_lines is not null and public.approval_financial_lines(p_expected_lines) is distinct from public.approval_financial_lines(proposal->'lines')) then raise exception 'prices or prescription changed; review the refreshed total'; end if;
 if p_final_amount_paise is null or p_final_amount_paise<0 or p_final_amount_paise>p_expected_total_paise then raise exception 'invalid final amount'; end if;
 update public.visit_pricing set final_amount_paise=p_final_amount_paise where visit_id=p_visit_id returning revision_number into revision;
 update public.pricing_approvals set request_id=p_request_id,request_payload=payload where visit_id=p_visit_id and revision_number=revision;
 perform set_config('app.queue_command','true',true);
 update public.visits set discount_requested_at=null where id=p_visit_id;
 perform set_config('app.queue_command','false',true);
 return revision;
end; $$;

CREATE OR REPLACE FUNCTION public.assign_token_number() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_token bigint;
begin
  update public.clinics
  set next_token_number = next_token_number + 1
  where id = new.clinic_id
  returning next_token_number - 1 into v_token;

  if v_token is null then
    raise exception 'unknown clinic_id %', new.clinic_id;
  end if;

  new.token_number := v_token;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.audit_medicine_price() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if new.price_paise is distinct from old.price_paise then
  insert into public.medicine_price_changes(clinic_id,medicine_id,old_price_paise,new_price_paise,changed_by) values(new.clinic_id,new.id,old.price_paise,new.price_paise,auth.uid());
 end if; return new;
end; $$;

CREATE OR REPLACE FUNCTION public.build_approval_lines(p_visit_id uuid, p_catalog_prices boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare result jsonb;
begin
 perform 1 from public.medicines m where id in (select pi.medicine_id from public.prescription_items pi join public.prescriptions p on p.id=pi.prescription_id where p.visit_id=p_visit_id) order by id for share;
 select jsonb_agg(line order by sort_key) into result from (
  select '0' as sort_key, jsonb_build_object('kind','consultation','description','Consultation','quantity',1,'unit_price_paise',c.consultation_fee_paise,'line_total_paise',c.consultation_fee_paise,'diagnosis',null,'advice',null) as line
    from public.visits v join public.clinics c on c.id=v.clinic_id where v.id=p_visit_id
  union all
  select '1'||vp.id::text,jsonb_build_object('kind','procedure','visit_procedure_id',vp.id,'procedure_id',vp.procedure_id,'description',p.name,'quantity',1,'unit_price_paise',vp.price_paise,'line_total_paise',vp.price_paise,'diagnosis',null,'advice',null)
    from public.visit_procedures vp join public.procedures p on p.id=vp.procedure_id where vp.visit_id=p_visit_id
  union all
  select '2'||pi.id::text,jsonb_build_object('kind','medicine','prescription_item_id',pi.id,'medicine_id',pi.medicine_id,'description',m.name,
    'quantity',pi.quantity_dispensed,'stock_unit',pi.stock_unit,'unit_price_paise',case when p_catalog_prices then m.price_paise else pi.unit_price_paise end,
    'line_total_paise',pi.quantity_dispensed*(case when p_catalog_prices then m.price_paise else pi.unit_price_paise end),
    'drug_type',pi.drug_type,'strength',pi.strength,'before_after_food',pi.before_after_food,'dosage_frequency',pi.dosage_frequency,'duration_days',pi.duration_days,'notes',pi.notes,'diagnosis',p.diagnosis,'advice',p.advice)
    from public.prescriptions p join public.prescription_items pi on pi.prescription_id=p.id join public.medicines m on m.id=pi.medicine_id where p.visit_id=p_visit_id
 ) rows;
 return coalesce(result,'[]'::jsonb);
end; $$;

CREATE OR REPLACE FUNCTION public.bump_pricing_revision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare lines jsonb;
begin
 if coalesce(current_setting('app.pricing_recompute',true),'')<>'true' then
  if not old.final_amount_set and not exists(select 1 from public.visits where id=new.visit_id and stage='paid') then
   lines:=public.build_approval_lines(new.visit_id);
   if exists(select 1 from jsonb_array_elements(lines) l where l->>'kind'='medicine' and (l->>'stock_unit' is null or (l->>'quantity')::int is null or (l->>'quantity')::int<=0)) then raise exception 'confirm medicine units and quantities before approval'; end if;
   select coalesce(sum((l->>'line_total_paise')::bigint),0) into new.calculated_total_paise from jsonb_array_elements(lines) l;
  end if;
  new.final_amount_set:=true;
  new.updated_by:=auth.uid();
 else
  -- A changed prescription or procedure needs a new approval, even if totals match.
  new.final_amount_set:=false;
 end if;
 new.revision_number:=old.revision_number+1; new.updated_at:=now(); return new;
end; $$;

CREATE OR REPLACE FUNCTION public.confirm_bill(p_visit_id uuid, p_payment_method text, p_snapshot_final_amount_paise bigint DEFAULT NULL::bigint, p_snapshot_revision_number bigint DEFAULT NULL::bigint, p_supplied_items jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
end; $_$;

CREATE OR REPLACE FUNCTION public.confirm_legacy_prescription_units() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if old.unit_confirmed_at is null and new.unit_confirmed_at is not null then
    perform set_config('app.pricing_recompute', 'true', true);
    update public.visit_pricing vp set final_amount_set = false where exists (
      select 1 from public.prescription_items pi join public.prescriptions p on p.id = pi.prescription_id
      join public.visits v on v.id = p.visit_id where p.visit_id = vp.visit_id and v.stage <> 'paid'
        and pi.medicine_id = new.id and pi.unit_price_paise is null);
    perform set_config('app.pricing_recompute', 'false', true);
    delete from public.pricing_approvals a where exists (
      select 1 from public.prescription_items pi join public.prescriptions p on p.id = pi.prescription_id
      join public.visits v on v.id = p.visit_id where p.visit_id = a.visit_id and v.stage <> 'paid'
        and pi.medicine_id = new.id and pi.unit_price_paise is null);
    update public.prescription_items pi set unit_price_paise = new.price_paise, stock_unit = new.stock_unit
    where pi.medicine_id = new.id and pi.unit_price_paise is null and pi.quantity_dispensed is not null
      and exists (select 1 from public.prescriptions p join public.visits v on v.id = p.visit_id
        where p.id = pi.prescription_id and v.stage <> 'paid');
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.confirm_pharmacy_sale(p_sale_id uuid, p_payment_method text, p_expected_amount_paise bigint) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare s public.pharmacy_sales; v_bill_id uuid; v_counter_id uuid;
begin
  select * into s from public.pharmacy_sales where id = p_sale_id for update;
  if s.id is null or not public.has_clinic_role(s.clinic_id, 'receptionist') then raise exception 'only clinic reception can confirm payment'; end if;
  if s.bill_id is not null then return s.bill_id; end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'upi') then raise exception 'choose Cash or UPI'; end if;
  if p_expected_amount_paise is distinct from s.final_amount_paise then raise exception 'doctor changed the payable amount; review before confirming payment'; end if;
  select id into v_counter_id from public.stock_points where clinic_id = s.clinic_id and name = 'Counter';
  if v_counter_id is null then raise exception 'configure a Counter stock point before payment'; end if;
  insert into public.bills (clinic_id, pharmacy_sale_id, final_amount_paise, pricing_revision_at_confirm, payment_method, confirmed_by)
  values (s.clinic_id, s.id, s.final_amount_paise, 0, p_payment_method, auth.uid()) returning id into v_bill_id;
  insert into public.bill_line_items (clinic_id, bill_id, kind, medicine_id, description, quantity, stock_unit, unit_price_paise)
  select clinic_id, v_bill_id, 'medicine', medicine_id, description, quantity, stock_unit, unit_price_paise
  from public.pharmacy_sale_items where sale_id = s.id;
  insert into public.stock_movements (clinic_id, medicine_id, stock_point_id, quantity_delta, reason, reference_id, created_by)
  select clinic_id, medicine_id, v_counter_id, -quantity, 'dispensed', id, auth.uid() from public.pharmacy_sale_items where sale_id = s.id;
  update public.pharmacy_sales set bill_id = v_bill_id where id = s.id;
  return v_bill_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.correct_bill(p_bill_id uuid, p_expected_amount_paise bigint DEFAULT NULL::bigint) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare b public.bills; p public.visit_pricing; subtotal bigint; discount bigint; result uuid;
begin
 select * into b from public.bills where id=p_bill_id for update;
 if b.id is null or b.visit_id is null or not public.has_clinic_role(b.clinic_id,'doctor') then raise exception 'doctor and consultation bill required'; end if;
 if exists(select 1 from public.bills where corrects_bill_id=b.id) then
 select id into result from public.bills where corrects_bill_id=b.id and (p_expected_amount_paise is null or final_amount_paise=p_expected_amount_paise);
 if result is null then raise exception 'bill already corrected to another amount'; end if;
 return result; end if;
 select * into p from public.visit_pricing where visit_id=b.visit_id for update;
 if not p.final_amount_set then raise exception 'doctor approval required'; end if;
 select sum(line_total_paise) into subtotal from public.bill_line_items where bill_id=b.id;
 if subtotal is null then raise exception 'original receipt lines unavailable; review this legacy bill'; end if;
 discount:=p.calculated_total_paise-p.final_amount_paise;
 if p_expected_amount_paise is not null and p_expected_amount_paise<>greatest(0,subtotal-discount) then raise exception 'correction changed; review the refreshed amount'; end if;
 insert into public.bills(clinic_id,visit_id,final_amount_paise,pricing_revision_at_confirm,payment_method,confirmed_by,corrects_bill_id,approved_discount_paise)
 values(b.clinic_id,b.visit_id,greatest(0,subtotal-discount),p.revision_number,b.payment_method,auth.uid(),b.id,discount) returning id into result;
 insert into public.bill_line_items(clinic_id,bill_id,kind,procedure_id,medicine_id,description,quantity,unit_price_paise,stock_unit,prescription_item_id,approved_quantity)
 select clinic_id,result,kind,procedure_id,medicine_id,description,quantity,unit_price_paise,stock_unit,prescription_item_id,approved_quantity from public.bill_line_items where bill_id=b.id;
 return result;
end; $$;

CREATE OR REPLACE FUNCTION public.create_stock_transfer(p_clinic_id uuid, p_medicine_id uuid, p_from_stock_point_id uuid, p_to_stock_point_id uuid, p_quantity integer, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_reference_id uuid := gen_random_uuid();
begin
  if p_quantity <= 0 then
    raise exception 'transfer quantity must be positive';
  end if;
  if p_from_stock_point_id = p_to_stock_point_id then
    raise exception 'cannot transfer a stock point to itself';
  end if;

  insert into public.stock_movements (clinic_id, medicine_id, stock_point_id, quantity_delta, reason, reference_id, notes, created_by)
  values (p_clinic_id, p_medicine_id, p_from_stock_point_id, -p_quantity, 'transfer_out', v_reference_id, p_notes, auth.uid());

  insert into public.stock_movements (clinic_id, medicine_id, stock_point_id, quantity_delta, reason, reference_id, notes, created_by)
  values (p_clinic_id, p_medicine_id, p_to_stock_point_id, p_quantity, 'transfer_in', v_reference_id, p_notes, auth.uid());

  return v_reference_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.create_visit_pricing() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_fee bigint;
begin
  select consultation_fee_paise into v_fee
  from public.clinics
  where id = new.clinic_id;

  insert into public.visit_pricing (clinic_id, visit_id, calculated_total_paise, final_amount_paise, revision_number)
  values (new.clinic_id, new.id, v_fee, v_fee, 0);

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.enforce_patient_long_term_authorship() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if (new.is_long_term is distinct from old.is_long_term
      or new.long_term_review_interval_days is distinct from old.long_term_review_interval_days)
     and not public.has_clinic_role(new.clinic_id, 'doctor') then
    raise exception 'only a doctor can flag a patient long-term';
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.enforce_visit_followup_authorship() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.follow_up_date is distinct from old.follow_up_date
     and not public.has_clinic_role(new.clinic_id, 'doctor') then
    raise exception 'only a doctor can set a visit follow-up date';
  end if;

  if new.follow_up_done_at is distinct from old.follow_up_done_at
     and not (public.has_clinic_role(new.clinic_id, 'doctor') or public.has_clinic_role(new.clinic_id, 'receptionist')) then
    raise exception 'only doctor or reception can change a follow-up''s done status';
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.ensure_final_amount_set_on_packing() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.stage = 'packing' and old.stage is distinct from 'packing' then
    update public.visit_pricing
    set final_amount_paise = final_amount_paise
    where visit_id = new.id
      and final_amount_set = false;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.get_approved_bill(p_visit_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE OR REPLACE FUNCTION public.get_daily_report(p_date date DEFAULT CURRENT_DATE) RETURNS TABLE(collections_paise bigint, patient_count integer, discount_paise bigint, needs_reconciliation_count integer, corrections_today_count integer, corrections_today_net_paise bigint)
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

CREATE OR REPLACE FUNCTION public.get_pricing_proposal(p_visit_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare c uuid; lines jsonb; total bigint; revision bigint;
begin
 select clinic_id into c from public.visits where id=p_visit_id;
 if not public.has_clinic_role(c,'doctor') then raise exception 'doctor required'; end if;
 select a.lines into lines from public.pricing_approvals a join public.visit_pricing vp on vp.visit_id=a.visit_id and vp.revision_number=a.revision_number where a.visit_id=p_visit_id and vp.final_amount_set;
 lines:=coalesce(lines,public.build_approval_lines(p_visit_id));
 select coalesce(sum((l->>'line_total_paise')::bigint),0) into total from jsonb_array_elements(lines) l;
 select revision_number into revision from public.visit_pricing where visit_id=p_visit_id;
 return jsonb_build_object('lines',lines,'total_paise',total,'revision_number',revision);
end; $$;

CREATE OR REPLACE FUNCTION public.get_stock_warnings_report() RETURNS TABLE(medicine_name text, total_quantity integer, low_stock_threshold integer)
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

CREATE OR REPLACE FUNCTION public.get_visit_billing_detail(p_visit_id uuid) RETURNS TABLE(kind text, description text, unit_price_paise bigint, drug_type text, strength text, before_after_food text, dosage_frequency text, duration_days integer, notes text, quantity integer, stock_unit text, line_total_paise bigint, diagnosis text, advice text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_clinic_id uuid;
  v_stage text;
  v_fee bigint;
begin
  select clinic_id, stage into v_clinic_id, v_stage
  from public.visits
  where id = p_visit_id;

  if v_clinic_id is null then
    return;
  end if;

  if not (
    public.has_clinic_role(v_clinic_id, 'doctor')
    or (public.has_clinic_role(v_clinic_id, 'receptionist') and v_stage in ('ready_to_bill', 'paid'))
  ) then
    return;
  end if;

  select consultation_fee_paise into v_fee from public.clinics where id = v_clinic_id;

  return query
  select 'consultation'::text, 'Consultation'::text, v_fee,
         null::text, null::text, null::text, null::text, null::int, null::text, 1, null::text, v_fee, null::text, null::text
  union all
  select 'procedure'::text, p.name, vp.price_paise,
         null::text, null::text, null::text, null::text, null::int, null::text, 1, null::text, vp.price_paise, null::text, null::text
  from public.visit_procedures vp
  join public.procedures p on p.id = vp.procedure_id
  where vp.visit_id = p_visit_id
  union all
  select 'medicine'::text, m.name, pi.unit_price_paise,
         pi.drug_type, pi.strength, pi.before_after_food, pi.dosage_frequency, pi.duration_days, pi.notes, pi.quantity_dispensed, pi.stock_unit, pi.unit_price_paise * pi.quantity_dispensed, pr.diagnosis, pr.advice
  from public.prescription_items pi
  join public.prescriptions pr on pr.id = pi.prescription_id
  join public.medicines m on m.id = pi.medicine_id
  where pr.visit_id = p_visit_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.guard_dispensing_stock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE OR REPLACE FUNCTION public.guard_queue_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if coalesce(current_setting('app.queue_command',true),'')='true' then return new; end if;
  -- Payment is authored by the atomic billing RPC, after its immutable bill insert.
  if new.stage='paid' and new.discount_requested_at is not distinct from old.discount_requested_at and exists(select 1 from public.bills where visit_id=new.id) then return new; end if;
  if new.discount_requested_at is distinct from old.discount_requested_at or new.stage is distinct from old.stage or new.queue_position is distinct from old.queue_position
     or new.called_at is distinct from old.called_at or new.sent_in_at is distinct from old.sent_in_at
     or new.not_here_at is distinct from old.not_here_at or new.queue_note is distinct from old.queue_note then
    raise exception 'use queue actions; older pending stage changes require review in the updated app';
  end if;
  return new;
end; $$;

CREATE OR REPLACE FUNCTION public.has_any_clinic_role(p_clinic_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and clinic_id = p_clinic_id
  );
$$;

CREATE OR REPLACE FUNCTION public.has_clinic_role(p_clinic_id uuid, p_role text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and clinic_id = p_clinic_id
      and role = p_role
  );
$$;

CREATE OR REPLACE FUNCTION public.health_ping() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.clinics);
$$;

CREATE OR REPLACE FUNCTION public.initialize_queue_position() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if auth.uid() is not null and new.stage <> 'waiting' then raise exception 'check in as waiting'; end if;
  perform 1 from public.clinics where id=new.clinic_id for update;
  select coalesce(max(queue_position),0)+1024 into new.queue_position from public.visits
    where clinic_id=new.clinic_id and (arrived_at at time zone 'Asia/Kolkata')::date=(new.arrived_at at time zone 'Asia/Kolkata')::date;
  new.called_at:=null; new.sent_in_at:=null; new.not_here_at:=null; new.queue_note:=null;
  return new;
end; $$;

CREATE OR REPLACE FUNCTION public.list_clinic_logins(p_clinic_id uuid) RETURNS TABLE(user_id uuid, email text, role text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.has_clinic_role(p_clinic_id, 'admin') then
    return;
  end if;

  return query
  select ur.user_id, u.email::text, ur.role
  from public.user_roles ur
  join auth.users u on u.id = ur.user_id
  where ur.clinic_id = p_clinic_id
  order by u.email, ur.role;
end;
$$;

CREATE OR REPLACE FUNCTION public.mark_follow_up_done(p_visit_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.visits where id = p_visit_id;

  if v_clinic_id is null then
    raise exception 'unknown visit %', p_visit_id;
  end if;

  if not public.has_clinic_role(v_clinic_id, 'receptionist') then
    raise exception 'only reception can mark a follow-up done';
  end if;

  update public.visits
  set follow_up_done_at = now()
  where id = p_visit_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.merge_patients(p_patient_a uuid, p_patient_b uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_clinic_id uuid;
  v_clinic_b uuid;
  v_created_a timestamptz;
  v_created_b timestamptz;
  v_keep_id uuid;
  v_remove_id uuid;
  v_today timestamptz := date_trunc('day', now());
begin
  select clinic_id, created_at into v_clinic_id, v_created_a from public.patients where id = p_patient_a;
  select clinic_id, created_at into v_clinic_b, v_created_b from public.patients where id = p_patient_b;

  if v_clinic_id is null or v_clinic_b is null then
    raise exception 'unknown patient';
  end if;
  if v_clinic_id <> v_clinic_b then
    raise exception 'patients belong to different clinics';
  end if;
  if not public.has_clinic_role(v_clinic_id, 'doctor') then
    raise exception 'only a doctor can merge patients';
  end if;

  if v_created_a <= v_created_b then
    v_keep_id := p_patient_a;
    v_remove_id := p_patient_b;
  else
    v_keep_id := p_patient_b;
    v_remove_id := p_patient_a;
  end if;

  if exists (
    select 1 from public.visits
    where patient_id in (v_keep_id, v_remove_id)
      and arrived_at >= v_today
      and stage <> 'paid'
  ) then
    raise exception 'one of these patients has an open visit today -- resolve it before merging';
  end if;

  update public.visits set patient_id = v_keep_id where patient_id = v_remove_id;
  update public.patient_comments set patient_id = v_keep_id where patient_id = v_remove_id;

  delete from public.patients where id = v_remove_id;

  return v_keep_id;
end;
$$;

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

CREATE OR REPLACE FUNCTION public.recompute_visit_pricing(p_visit_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_clinic_id uuid;
  v_fee bigint;
  v_procedures_total bigint;
  v_medicines_total bigint;
  v_total bigint;
begin
  select clinic_id into v_clinic_id from public.visits where id = p_visit_id;
  if v_clinic_id is null then
    return;
  end if;

  select consultation_fee_paise into v_fee from public.clinics where id = v_clinic_id;

  select coalesce(sum(price_paise), 0) into v_procedures_total
  from public.visit_procedures
  where visit_id = p_visit_id;

  select coalesce(sum(pi.unit_price_paise * pi.quantity_dispensed), 0) into v_medicines_total
  from public.prescription_items pi
  join public.prescriptions pr on pr.id = pi.prescription_id
  join public.medicines m on m.id = pi.medicine_id
  where pr.visit_id = p_visit_id;

  v_total := v_fee + v_procedures_total + v_medicines_total;

  perform set_config('app.pricing_recompute', 'true', true);

  update public.visit_pricing
  set calculated_total_paise = v_total,
      final_amount_paise = case
        when final_amount_set then least(final_amount_paise, v_total)
        else v_total
      end
  where visit_id = p_visit_id;

  perform set_config('app.pricing_recompute', 'false', true);
end;
$$;

CREATE OR REPLACE FUNCTION public.recompute_visit_pricing_from_prescription_items() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_visit_id uuid;
begin
  if TG_OP = 'INSERT' then
    for v_visit_id in
      select distinct pr.visit_id
      from public.prescriptions pr
      where pr.id in (select prescription_id from new_rows)
    loop
      perform public.recompute_visit_pricing(v_visit_id);
    end loop;
  elsif TG_OP = 'DELETE' then
    for v_visit_id in
      select distinct pr.visit_id
      from public.prescriptions pr
      where pr.id in (select prescription_id from old_rows)
    loop
      perform public.recompute_visit_pricing(v_visit_id);
    end loop;
  else
    for v_visit_id in
      select distinct pr.visit_id
      from public.prescriptions pr
      where pr.id in (
        select prescription_id from new_rows
        union
        select prescription_id from old_rows
      )
    loop
      perform public.recompute_visit_pricing(v_visit_id);
    end loop;
  end if;
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION public.recompute_visit_pricing_from_procedures() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_visit_id uuid;
begin
  if TG_OP = 'INSERT' then
    for v_visit_id in select distinct visit_id from new_rows loop
      perform public.recompute_visit_pricing(v_visit_id);
    end loop;
  elsif TG_OP = 'DELETE' then
    for v_visit_id in select distinct visit_id from old_rows loop
      perform public.recompute_visit_pricing(v_visit_id);
    end loop;
  else
    for v_visit_id in
      select distinct visit_id from new_rows
      union
      select distinct visit_id from old_rows
    loop
      perform public.recompute_visit_pricing(v_visit_id);
    end loop;
  end if;
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION public.record_pricing_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if new.final_amount_set then
  insert into public.pricing_approvals(clinic_id,visit_id,revision_number,final_amount_paise,lines,discount_paise,approved_by)
  values(new.clinic_id,new.visit_id,new.revision_number,new.final_amount_paise,case when tg_op='UPDATE' and old.final_amount_set then (select a.lines from public.pricing_approvals a where a.visit_id=old.visit_id and a.revision_number=old.revision_number) else public.build_approval_lines(new.visit_id) end,new.calculated_total_paise-new.final_amount_paise,auth.uid());
 end if; return new;
end; $$;

CREATE OR REPLACE FUNCTION public.record_purchase(p_clinic_id uuid, p_supplier_id uuid, p_invoice_number text, p_purchase_date date, p_stock_point_id uuid, p_items jsonb) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_purchase_id uuid;
  v_item jsonb;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'a purchase needs at least one item';
  end if;

  insert into public.purchases (clinic_id, supplier_id, invoice_number, purchase_date, stock_point_id, created_by)
  values (p_clinic_id, p_supplier_id, p_invoice_number, p_purchase_date, p_stock_point_id, auth.uid())
  returning id into v_purchase_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.purchase_items (clinic_id, purchase_id, medicine_id, quantity, cost_price_paise)
    values (
      p_clinic_id,
      v_purchase_id,
      (v_item ->> 'medicine_id')::uuid,
      (v_item ->> 'quantity')::int,
      (v_item ->> 'cost_price_paise')::bigint
    );

    insert into public.stock_movements (clinic_id, medicine_id, stock_point_id, quantity_delta, reason, reference_id, created_by)
    values (
      p_clinic_id,
      (v_item ->> 'medicine_id')::uuid,
      p_stock_point_id,
      (v_item ->> 'quantity')::int,
      'purchase',
      v_purchase_id,
      auth.uid()
    );
  end loop;

  return v_purchase_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.record_stock_count(p_clinic_id uuid, p_stock_point_id uuid, p_lines jsonb) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_stock_count_id uuid;
  v_line jsonb;
  v_medicine_id uuid;
  v_counted int;
  v_expected int;
  v_gap int;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'a stock count needs at least one line';
  end if;

  insert into public.stock_counts (clinic_id, stock_point_id, counted_by)
  values (p_clinic_id, p_stock_point_id, auth.uid())
  returning id into v_stock_count_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_medicine_id := (v_line ->> 'medicine_id')::uuid;
    v_counted := (v_line ->> 'counted_quantity')::int;

    select coalesce(quantity, 0) into v_expected
    from public.medicine_stock
    where medicine_id = v_medicine_id and stock_point_id = p_stock_point_id;
    v_expected := coalesce(v_expected, 0);

    insert into public.stock_count_lines (clinic_id, stock_count_id, medicine_id, expected_quantity, counted_quantity)
    values (p_clinic_id, v_stock_count_id, v_medicine_id, v_expected, v_counted);

    v_gap := v_counted - v_expected;
    if v_gap <> 0 then
      insert into public.stock_movements (clinic_id, medicine_id, stock_point_id, quantity_delta, reason, reference_id, created_by)
      values (p_clinic_id, v_medicine_id, p_stock_point_id, v_gap, 'count_correction', v_stock_count_id, auth.uid());
    end if;
  end loop;

  return v_stock_count_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.request_bill_discount(p_visit_id uuid, p_request_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE OR REPLACE FUNCTION public.reset_long_term_review_on_visit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_is_long_term boolean;
  v_interval int;
begin
  select is_long_term, long_term_review_interval_days into v_is_long_term, v_interval
  from public.patients
  where id = new.patient_id;

  if v_is_long_term and v_interval is not null then
    update public.patients
    set next_review_due = new.arrived_at::date + v_interval
    where id = new.patient_id;
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_pharmacy_sale(p_sale_id uuid, p_clinic_id uuid, p_customer_name text, p_items jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare i record; m public.medicines; v_total bigint := 0;
begin
  if not (public.has_clinic_role(p_clinic_id, 'doctor') or public.has_clinic_role(p_clinic_id, 'receptionist')) then
    raise exception 'only clinic staff can prepare a pharmacy bill';
  end if;
  if p_sale_id is null then raise exception 'sale id is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_sale_id::text, 0));
  if exists (select 1 from public.pharmacy_sales where id = p_sale_id and clinic_id = p_clinic_id) then return p_sale_id; end if;
  if p_customer_name is null or length(btrim(p_customer_name)) not between 1 and 200 then raise exception 'customer name is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'supplied medicines are required'; end if;
  insert into public.pharmacy_sales (id, clinic_id, customer_name, final_amount_paise, created_by)
  values (p_sale_id, p_clinic_id, btrim(p_customer_name), 0, auth.uid());
  for i in select * from jsonb_to_recordset(p_items) as x(medicine_id uuid, quantity int, unit_price_paise bigint, stock_unit text) loop
    select * into m from public.medicines where id = i.medicine_id and clinic_id = p_clinic_id for share;
    if m.id is null or m.unit_confirmed_at is null then raise exception 'confirm the medicine unit and price under Stock first'; end if;
    if i.quantity is null or i.quantity <= 0 then raise exception 'supplied quantity must be a positive whole number'; end if;
    if i.unit_price_paise is distinct from m.price_paise or i.stock_unit is distinct from m.stock_unit then
      raise exception 'catalog price or unit changed; review the pharmacy bill before saving';
    end if;
    insert into public.pharmacy_sale_items (clinic_id, sale_id, medicine_id, description, quantity, stock_unit, unit_price_paise)
    values (p_clinic_id, p_sale_id, m.id, m.name, i.quantity, m.stock_unit, m.price_paise);
    v_total := v_total + i.quantity::bigint * m.price_paise;
  end loop;
  update public.pharmacy_sales set final_amount_paise = v_total where id = p_sale_id;
  return p_sale_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.save_prescription(p_prescription_id uuid, p_visit_id uuid, p_items jsonb, p_diagnosis text DEFAULT NULL::text, p_advice text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_clinic_id uuid;
  v_stage text;
begin
  select clinic_id, stage into v_clinic_id, v_stage
  from public.visits where id = p_visit_id for update;
  if v_clinic_id is null or not public.has_clinic_role(v_clinic_id, 'doctor') then
    raise exception 'only the clinic doctor can save a prescription';
  end if;
  if exists (select 1 from public.prescriptions where id = p_prescription_id and visit_id = p_visit_id and clinic_id = v_clinic_id) then
    return p_prescription_id;
  end if;
  if v_stage not in ('waiting', 'with_doctor') then
    raise exception 'reopen the consultation before prescribing';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'prescription items are required';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as i(medicine_id uuid)
    left join public.medicines m on m.id = i.medicine_id and m.clinic_id = v_clinic_id
    where m.id is null
  ) then
    raise exception 'every medicine must belong to this clinic';
  end if;
  insert into public.prescriptions (id, clinic_id, visit_id, diagnosis, advice)
  values (p_prescription_id, v_clinic_id, p_visit_id, nullif(btrim(p_diagnosis), ''), nullif(btrim(p_advice), ''));
  insert into public.prescription_items (id, clinic_id, prescription_id, medicine_id, drug_type, strength,
    before_after_food, dosage_frequency, duration_days, quantity_dispensed, notes)
  select i.id, v_clinic_id, p_prescription_id, i.medicine_id, i.drug_type, i.strength,
    i.before_after_food, i.dosage_frequency, i.duration_days, i.quantity_dispensed, i.notes
  from jsonb_to_recordset(p_items) as i(id uuid, medicine_id uuid, drug_type text, strength text,
    before_after_food text, dosage_frequency text, duration_days int, quantity_dispensed int, notes text);
  return p_prescription_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.search_patients(p_clinic_id uuid, p_query text) RETURNS TABLE(id uuid, name text, age integer, gender text, phone text, address text, last_visit_at timestamp with time zone)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select
    p.id, p.name, p.age, p.gender, p.phone, p.address,
    (select max(v.arrived_at) from public.visits v where v.patient_id = p.id) as last_visit_at
  from public.patients p
  where p.clinic_id = p_clinic_id
    and (p.phone like (p_query || '%') or p.name operator(extensions.%) p_query)
  order by
    (select max(v.arrived_at) from public.visits v where v.patient_id = p.id) desc nulls last,
    extensions.similarity(p.name, p_query) desc
  limit 20;
$$;

CREATE OR REPLACE FUNCTION public.set_bill_needs_reconciliation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare v_current_revision bigint;
begin
  if new.visit_id is null then new.needs_reconciliation := false; return new; end if;
  select revision_number into v_current_revision from public.visit_pricing where visit_id = new.visit_id;
  new.needs_reconciliation := (v_current_revision is distinct from new.pricing_revision_at_confirm);
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.set_medicine_unit_price(p_medicine_id uuid, p_stock_unit text, p_price_paise bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare m public.medicines;
begin
  select * into m from public.medicines where id = p_medicine_id for update;
  if m.id is null or not (public.has_clinic_role(m.clinic_id, 'doctor') or public.has_clinic_role(m.clinic_id, 'receptionist')) then
    raise exception 'only clinic staff can set medicine units and prices';
  end if;
  if p_stock_unit is null or length(btrim(p_stock_unit)) not between 1 and 24 or p_price_paise is null or p_price_paise < 0 then
    raise exception 'a unit and non-negative unit price are required';
  end if;
  if m.unit_confirmed_at is not null and m.stock_unit <> btrim(p_stock_unit) then
    raise exception 'confirmed stock units cannot change; use a separate catalog medicine for different packaging';
  end if;
  update public.medicines set stock_unit = btrim(p_stock_unit), price_paise = p_price_paise,
    unit_confirmed_at = coalesce(unit_confirmed_at, now()), updated_at = now() where id = m.id;
end;
$$;

CREATE OR REPLACE FUNCTION public.set_no_show_minutes(p_clinic_id uuid, p_minutes integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not (public.has_clinic_role(p_clinic_id,'doctor') or public.has_clinic_role(p_clinic_id,'admin')) then raise exception 'doctor or administrator required'; end if;
  if p_minutes is null or p_minutes not between 1 and 240 then raise exception 'use 1 to 240 minutes'; end if;
  update public.clinics set no_show_minutes=p_minutes where id=p_clinic_id;
end; $$;

CREATE OR REPLACE FUNCTION public.set_patient_long_term(p_patient_id uuid, p_is_long_term boolean, p_review_interval_days integer DEFAULT NULL::integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_clinic_id uuid;
  v_last_visit date;
begin
  select clinic_id into v_clinic_id from public.patients where id = p_patient_id;

  if v_clinic_id is null then
    raise exception 'unknown patient %', p_patient_id;
  end if;

  if not public.has_clinic_role(v_clinic_id, 'doctor') then
    raise exception 'only a doctor can flag a patient long-term';
  end if;

  if p_is_long_term then
    if p_review_interval_days is null or p_review_interval_days <= 0 then
      raise exception 'review interval must be a positive number of days';
    end if;

    select max(arrived_at)::date into v_last_visit
    from public.visits
    where patient_id = p_patient_id;

    update public.patients
    set is_long_term = true,
        long_term_review_interval_days = p_review_interval_days,
        next_review_due = coalesce(v_last_visit, current_date) + p_review_interval_days
    where id = p_patient_id;
  else
    update public.patients
    set is_long_term = false,
        long_term_review_interval_days = null,
        next_review_due = null
    where id = p_patient_id;
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.set_pharmacy_sale_amount(p_sale_id uuid, p_final_amount_paise bigint) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare s public.pharmacy_sales; b public.bills; v_total bigint; v_bill_id uuid;
begin
  select * into s from public.pharmacy_sales where id = p_sale_id for update;
  if s.id is null or not public.has_clinic_role(s.clinic_id, 'doctor') then raise exception 'only the clinic doctor can discount or correct a pharmacy bill'; end if;
  select sum(line_total_paise)::bigint into v_total from public.pharmacy_sale_items where sale_id = s.id;
  if p_final_amount_paise is null or p_final_amount_paise < 0 or p_final_amount_paise > v_total then raise exception 'payable amount must be between zero and the calculated total'; end if;
  if s.bill_id is not null and p_final_amount_paise <> s.final_amount_paise then
    select * into b from public.bills where id = s.bill_id;
    insert into public.bills (clinic_id, pharmacy_sale_id, final_amount_paise, pricing_revision_at_confirm, payment_method, confirmed_by, corrects_bill_id)
    values (s.clinic_id, s.id, p_final_amount_paise, 0, b.payment_method, auth.uid(), b.id) returning id into v_bill_id;
    insert into public.bill_line_items (clinic_id, bill_id, kind, medicine_id, description, quantity, stock_unit, unit_price_paise)
    select clinic_id, v_bill_id, kind, medicine_id, description, quantity, stock_unit, unit_price_paise from public.bill_line_items where bill_id = b.id;
    update public.pharmacy_sales set bill_id = v_bill_id where id = s.id;
  end if;
  update public.pharmacy_sales set final_amount_paise = p_final_amount_paise where id = s.id;
  return coalesce(v_bill_id, s.bill_id, s.id);
end;
$$;

CREATE OR REPLACE FUNCTION public.set_visit_follow_up(p_visit_id uuid, p_follow_up_date date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.visits where id = p_visit_id;

  if v_clinic_id is null then
    raise exception 'unknown visit %', p_visit_id;
  end if;

  if not public.has_clinic_role(v_clinic_id, 'doctor') then
    raise exception 'only a doctor can set a visit follow-up date';
  end if;

  -- A revised date starts a fresh to-do -- any earlier "done" mark no
  -- longer applies to it.
  update public.visits
  set follow_up_date = p_follow_up_date, follow_up_done_at = null
  where id = p_visit_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.settle_bill(p_bill_id uuid, p_payment_method text, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_clinic_id uuid;
  v_bill_payment_method text;
  v_id uuid;
begin
  select clinic_id, payment_method into v_clinic_id, v_bill_payment_method
  from public.bills
  where id = p_bill_id;

  if v_clinic_id is null then
    raise exception 'unknown bill %', p_bill_id;
  end if;

  if not public.has_clinic_role(v_clinic_id, 'receptionist') then
    raise exception 'only reception can settle a bill';
  end if;

  if v_bill_payment_method <> 'pay_later' then
    raise exception 'only a pay-later bill can be settled -- it was never unpaid';
  end if;

  if p_payment_method not in ('cash', 'upi') then
    raise exception 'settle payment method must be cash or upi';
  end if;

  insert into public.bill_settlements (clinic_id, bill_id, payment_method, settled_by, notes)
  values (v_clinic_id, p_bill_id, p_payment_method, auth.uid(), p_notes)
  returning id into v_id;

  return v_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_prescription_price() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare m public.medicines;
begin
  select * into m from public.medicines where id = new.medicine_id for share;
  if m.clinic_id is distinct from new.clinic_id or not exists (
    select 1 from public.prescriptions p where p.id = new.prescription_id and p.clinic_id = new.clinic_id
  ) then raise exception 'prescription and medicine must belong to the same clinic'; end if;
  if new.quantity_dispensed is null or new.quantity_dispensed <= 0 then
    raise exception 'enter the quantity supplied in the confirmed stock unit';
  end if;
  if tg_op = 'INSERT' or new.medicine_id is distinct from old.medicine_id or old.unit_price_paise is null then
    if m.unit_confirmed_at is null then raise exception 'confirm the medicine unit and price under Stock first'; end if;
    new.unit_price_paise := m.price_paise;
    new.stock_unit := m.stock_unit;
  else
    new.unit_price_paise := old.unit_price_paise;
    new.stock_unit := old.stock_unit;
  end if;
  return new;
end;
$$;

CREATE TABLE public.bill_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    bill_id uuid NOT NULL,
    kind text NOT NULL,
    procedure_id uuid,
    medicine_id uuid,
    description text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price_paise bigint NOT NULL,
    line_total_paise bigint GENERATED ALWAYS AS ((quantity * unit_price_paise)) STORED,
    stock_unit text,
    prescription_item_id uuid,
    approved_quantity integer,
    shortfall integer GENERATED ALWAYS AS ((COALESCE(approved_quantity, quantity) - quantity)) STORED,
    CONSTRAINT bill_line_items_approved_cap CHECK (((approved_quantity IS NULL) OR (quantity <= approved_quantity))),
    CONSTRAINT bill_line_items_approved_quantity_check CHECK ((approved_quantity > 0)),
    CONSTRAINT bill_line_items_kind_check CHECK ((kind = ANY (ARRAY['consultation'::text, 'procedure'::text, 'medicine'::text]))),
    CONSTRAINT bill_line_items_kind_fk_consistency CHECK ((((kind = 'procedure'::text) AND (procedure_id IS NOT NULL) AND (medicine_id IS NULL)) OR ((kind = 'medicine'::text) AND (medicine_id IS NOT NULL) AND (procedure_id IS NULL)) OR ((kind = 'consultation'::text) AND (procedure_id IS NULL) AND (medicine_id IS NULL)))),
    CONSTRAINT bill_line_items_quantity_check CHECK (((quantity >= 0) AND ((quantity > 0) OR (kind = 'medicine'::text)))),
    CONSTRAINT bill_line_items_unit_price_paise_check CHECK ((unit_price_paise >= 0))
);

CREATE TABLE public.bill_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    bill_id uuid NOT NULL,
    payment_method text NOT NULL,
    settled_by uuid NOT NULL,
    settled_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    CONSTRAINT bill_settlements_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'upi'::text])))
);

CREATE TABLE public.bills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    visit_id uuid,
    final_amount_paise bigint NOT NULL,
    pricing_revision_at_confirm bigint NOT NULL,
    payment_method text NOT NULL,
    confirmed_by uuid NOT NULL,
    confirmed_at timestamp with time zone DEFAULT now() NOT NULL,
    corrects_bill_id uuid,
    needs_reconciliation boolean DEFAULT false NOT NULL,
    pharmacy_sale_id uuid,
    approved_discount_paise bigint,
    CONSTRAINT bill_has_one_source CHECK (((visit_id IS NULL) <> (pharmacy_sale_id IS NULL))),
    CONSTRAINT bills_approved_discount_paise_check CHECK ((approved_discount_paise >= 0)),
    CONSTRAINT bills_final_amount_paise_check CHECK ((final_amount_paise >= 0)),
    CONSTRAINT bills_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'upi'::text, 'pay_later'::text])))
);

ALTER TABLE ONLY public.bills REPLICA IDENTITY FULL;

CREATE TABLE public.patients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    name text NOT NULL,
    age integer,
    gender text,
    address text,
    phone text,
    height_cm numeric,
    weight_kg numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    custom_fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_long_term boolean DEFAULT false NOT NULL,
    long_term_review_interval_days integer,
    next_review_due date,
    CONSTRAINT patients_gender_check CHECK ((gender = ANY (ARRAY['Male'::text, 'Female'::text, 'Other'::text]))),
    CONSTRAINT patients_long_term_shape CHECK ((((is_long_term = false) AND (long_term_review_interval_days IS NULL) AND (next_review_due IS NULL)) OR ((is_long_term = true) AND (long_term_review_interval_days > 0)))),
    CONSTRAINT patients_phone_check CHECK (((phone IS NULL) OR (phone ~ '^[0-9]{10}$'::text)))
);

CREATE TABLE public.visit_pricing (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    visit_id uuid NOT NULL,
    calculated_total_paise bigint NOT NULL,
    final_amount_paise bigint NOT NULL,
    discount_paise bigint GENERATED ALWAYS AS ((calculated_total_paise - final_amount_paise)) STORED,
    revision_number bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    final_amount_set boolean DEFAULT false NOT NULL,
    CONSTRAINT final_amount_not_over_total CHECK ((final_amount_paise <= calculated_total_paise)),
    CONSTRAINT visit_pricing_calculated_total_paise_check CHECK ((calculated_total_paise >= 0)),
    CONSTRAINT visit_pricing_final_amount_paise_check CHECK ((final_amount_paise >= 0))
);

ALTER TABLE ONLY public.visit_pricing REPLICA IDENTITY FULL;

CREATE TABLE public.visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    token_number bigint NOT NULL,
    arrived_at timestamp with time zone NOT NULL,
    stage text DEFAULT 'waiting'::text NOT NULL,
    complaint text NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    follow_up_date date,
    follow_up_done_at timestamp with time zone,
    with_doctor_at timestamp with time zone,
    consultation_ended_at timestamp with time zone,
    queue_position bigint NOT NULL,
    called_at timestamp with time zone,
    sent_in_at timestamp with time zone,
    not_here_at timestamp with time zone,
    queue_note text,
    discount_requested_at timestamp with time zone,
    CONSTRAINT visits_follow_up_done_requires_date CHECK (((follow_up_done_at IS NULL) OR (follow_up_date IS NOT NULL))),
    CONSTRAINT visits_stage_check CHECK ((stage = ANY (ARRAY['waiting'::text, 'called'::text, 'with_doctor'::text, 'ready_to_bill'::text, 'paid'::text, 'not_here'::text, 'no_show'::text])))
);

ALTER TABLE ONLY public.visits REPLICA IDENTITY FULL;

CREATE VIEW public.bills_needing_reconciliation WITH (security_invoker='true') AS
 SELECT b.id,
    b.clinic_id,
    b.visit_id,
    b.final_amount_paise,
    b.pricing_revision_at_confirm,
    b.payment_method,
    b.confirmed_by,
    b.confirmed_at,
    b.corrects_bill_id,
    b.needs_reconciliation,
    v.token_number,
    v.arrived_at,
    p.name AS patient_name,
        CASE
            WHEN ((NOT vp.final_amount_set) OR (NOT (EXISTS ( SELECT 1
               FROM public.bill_line_items li
              WHERE (li.bill_id = b.id))))) THEN NULL::bigint
            ELSE GREATEST((0)::bigint, (( SELECT (sum(li.line_total_paise))::bigint AS sum
               FROM public.bill_line_items li
              WHERE (li.bill_id = b.id)) - (vp.calculated_total_paise - vp.final_amount_paise)))
        END AS live_final_amount_paise,
    vp.revision_number AS live_revision_number
   FROM (((public.bills b
     JOIN public.visit_pricing vp ON ((vp.visit_id = b.visit_id)))
     JOIN public.visits v ON ((v.id = b.visit_id)))
     JOIN public.patients p ON ((p.id = v.patient_id)))
  WHERE ((b.pricing_revision_at_confirm <> vp.revision_number) AND (NOT (EXISTS ( SELECT 1
           FROM public.bills c
          WHERE (c.corrects_bill_id = b.id)))));

CREATE TABLE public.clinic_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    visit_id uuid NOT NULL,
    document_type text NOT NULL,
    purpose text,
    rest_from date,
    rest_to date,
    reason text,
    referred_to text,
    case_summary text,
    issued_by uuid NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT clinic_documents_document_type_check CHECK ((document_type = ANY (ARRAY['certificate'::text, 'sick_leave'::text, 'referral'::text]))),
    CONSTRAINT clinic_documents_rest_period_order CHECK (((rest_to IS NULL) OR (rest_from IS NULL) OR (rest_to >= rest_from))),
    CONSTRAINT clinic_documents_shape CHECK ((((document_type = 'certificate'::text) AND (purpose IS NOT NULL)) OR ((document_type = 'sick_leave'::text) AND (rest_from IS NOT NULL) AND (rest_to IS NOT NULL) AND (reason IS NOT NULL)) OR ((document_type = 'referral'::text) AND (referred_to IS NOT NULL) AND (reason IS NOT NULL))))
);

CREATE TABLE public.clinics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    consultation_fee_paise bigint DEFAULT 25000 NOT NULL,
    next_token_number bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    upi_vpa text,
    doctor_name text,
    doctor_registration_number text,
    address text,
    phone text,
    no_show_minutes integer DEFAULT 30 NOT NULL,
    CONSTRAINT clinics_no_show_minutes_check CHECK (((no_show_minutes >= 1) AND (no_show_minutes <= 240)))
);

CREATE VIEW public.long_term_register WITH (security_invoker='true') AS
 SELECT id AS patient_id,
    clinic_id,
    name,
    long_term_review_interval_days,
    next_review_due,
    ( SELECT max(v.arrived_at) AS max
           FROM public.visits v
          WHERE (v.patient_id = p.id)) AS last_visit_at
   FROM public.patients p
  WHERE (is_long_term = true);

CREATE TABLE public.medicine_price_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    old_price_paise bigint NOT NULL,
    new_price_paise bigint NOT NULL,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.medicine_stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    stock_point_id uuid NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.medicines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    name text NOT NULL,
    price_paise bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    drug_type text,
    strength_options text[],
    low_stock_threshold integer,
    expiry_date date,
    stock_unit text,
    unit_confirmed_at timestamp with time zone,
    CONSTRAINT medicines_drug_type_check CHECK (((drug_type IS NULL) OR (drug_type = ANY (ARRAY['Tablet'::text, 'Syrup'::text, 'Capsule'::text, 'Powder'::text, 'Injection'::text, 'Other'::text])))),
    CONSTRAINT medicines_low_stock_threshold_check CHECK (((low_stock_threshold IS NULL) OR (low_stock_threshold >= 0))),
    CONSTRAINT medicines_price_paise_check CHECK ((price_paise >= 0)),
    CONSTRAINT medicines_stock_unit_check CHECK (((stock_unit IS NULL) OR ((length(btrim(stock_unit)) >= 1) AND (length(btrim(stock_unit)) <= 24))))
);

CREATE TABLE public.patient_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.patient_field_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    field_type text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT patient_field_definitions_field_type_check CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'date'::text, 'boolean'::text])))
);

CREATE TABLE public.pharma_rep_checkins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    rep_name text NOT NULL,
    company text NOT NULL,
    arrived_at timestamp with time zone DEFAULT now() NOT NULL,
    done_at timestamp with time zone,
    checked_in_by uuid NOT NULL
);

CREATE TABLE public.pharmacy_sale_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    sale_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    description text NOT NULL,
    quantity integer NOT NULL,
    stock_unit text NOT NULL,
    unit_price_paise bigint NOT NULL,
    line_total_paise bigint GENERATED ALWAYS AS (((quantity)::bigint * unit_price_paise)) STORED,
    CONSTRAINT pharmacy_sale_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT pharmacy_sale_items_unit_price_paise_check CHECK ((unit_price_paise >= 0))
);

CREATE TABLE public.pharmacy_sales (
    id uuid NOT NULL,
    clinic_id uuid NOT NULL,
    customer_name text NOT NULL,
    final_amount_paise bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    bill_id uuid,
    CONSTRAINT pharmacy_sales_customer_name_check CHECK (((length(btrim(customer_name)) >= 1) AND (length(btrim(customer_name)) <= 200))),
    CONSTRAINT pharmacy_sales_final_amount_paise_check CHECK ((final_amount_paise >= 0))
);

CREATE TABLE public.prescription_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    prescription_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    drug_type text,
    strength text,
    before_after_food text,
    dosage_frequency text,
    duration_days integer NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    quantity_dispensed integer,
    unit_price_paise bigint,
    stock_unit text,
    CONSTRAINT prescription_items_before_after_food_check CHECK ((before_after_food = ANY (ARRAY['Before food'::text, 'After food'::text, 'Either'::text]))),
    CONSTRAINT prescription_items_dosage_frequency_check CHECK (((dosage_frequency IS NULL) OR ((length(btrim(dosage_frequency)) >= 1) AND (length(btrim(dosage_frequency)) <= 200)))),
    CONSTRAINT prescription_items_drug_type_check CHECK ((drug_type = ANY (ARRAY['Tablet'::text, 'Syrup'::text, 'Capsule'::text, 'Powder'::text, 'Injection'::text, 'Other'::text]))),
    CONSTRAINT prescription_items_duration_days_check CHECK ((duration_days > 0)),
    CONSTRAINT prescription_items_quantity_dispensed_check CHECK ((quantity_dispensed > 0)),
    CONSTRAINT prescription_items_unit_price_paise_check CHECK ((unit_price_paise >= 0))
);

CREATE TABLE public.prescription_template_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    template_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    drug_type text,
    strength text,
    before_after_food text,
    dosage_frequency text,
    duration_days integer NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prescription_template_items_before_after_food_check CHECK ((before_after_food = ANY (ARRAY['Before food'::text, 'After food'::text, 'Either'::text]))),
    CONSTRAINT prescription_template_items_dosage_frequency_check CHECK (((dosage_frequency IS NULL) OR ((length(btrim(dosage_frequency)) >= 1) AND (length(btrim(dosage_frequency)) <= 200)))),
    CONSTRAINT prescription_template_items_drug_type_check CHECK ((drug_type = ANY (ARRAY['Tablet'::text, 'Syrup'::text, 'Capsule'::text, 'Powder'::text, 'Injection'::text, 'Other'::text]))),
    CONSTRAINT prescription_template_items_duration_days_check CHECK ((duration_days > 0))
);

CREATE TABLE public.prescription_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.prescriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    visit_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    diagnosis text,
    advice text,
    CONSTRAINT prescriptions_advice_check CHECK ((length(advice) <= 10000)),
    CONSTRAINT prescriptions_diagnosis_check CHECK ((length(diagnosis) <= 10000))
);

CREATE TABLE public.pricing_approvals (
    clinic_id uuid NOT NULL,
    visit_id uuid NOT NULL,
    revision_number bigint NOT NULL,
    final_amount_paise bigint NOT NULL,
    approved_at timestamp with time zone DEFAULT now() NOT NULL,
    lines jsonb,
    discount_paise bigint,
    approved_by uuid,
    request_id uuid,
    request_payload jsonb,
    CONSTRAINT pricing_approvals_discount_paise_check CHECK ((discount_paise >= 0)),
    CONSTRAINT pricing_approvals_final_amount_paise_check CHECK ((final_amount_paise >= 0))
);

CREATE TABLE public.procedures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    name text NOT NULL,
    default_price_paise bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT procedures_default_price_paise_check CHECK ((default_price_paise >= 0))
);

CREATE TABLE public.purchase_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    purchase_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    quantity integer NOT NULL,
    cost_price_paise bigint NOT NULL,
    CONSTRAINT purchase_items_cost_price_paise_check CHECK ((cost_price_paise >= 0)),
    CONSTRAINT purchase_items_quantity_check CHECK ((quantity > 0))
);

CREATE TABLE public.purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    invoice_number text NOT NULL,
    purchase_date date NOT NULL,
    stock_point_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.queue_events (
    request_id uuid NOT NULL,
    clinic_id uuid NOT NULL,
    visit_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    action text NOT NULL,
    reason text,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    payload jsonb NOT NULL,
    resulting_stage text NOT NULL
);

CREATE TABLE public.stock_count_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    stock_count_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    expected_quantity integer NOT NULL,
    counted_quantity integer NOT NULL,
    gap_quantity integer GENERATED ALWAYS AS ((counted_quantity - expected_quantity)) STORED,
    CONSTRAINT stock_count_lines_counted_quantity_check CHECK ((counted_quantity >= 0))
);

CREATE TABLE public.stock_counts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    stock_point_id uuid NOT NULL,
    counted_by uuid NOT NULL,
    counted_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    stock_point_id uuid NOT NULL,
    quantity_delta integer NOT NULL,
    reason text NOT NULL,
    reference_id uuid,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_movements_adjustment_requires_notes CHECK (((reason <> 'adjustment'::text) OR ((notes IS NOT NULL) AND (TRIM(BOTH FROM notes) <> ''::text)))),
    CONSTRAINT stock_movements_quantity_delta_check CHECK ((quantity_delta <> 0)),
    CONSTRAINT stock_movements_reason_check CHECK ((reason = ANY (ARRAY['purchase'::text, 'transfer_in'::text, 'transfer_out'::text, 'dispensed'::text, 'adjustment'::text, 'count_correction'::text]))),
    CONSTRAINT stock_movements_sign_matches_reason CHECK ((((reason = ANY (ARRAY['purchase'::text, 'transfer_in'::text])) AND (quantity_delta > 0)) OR ((reason = ANY (ARRAY['transfer_out'::text, 'dispensed'::text])) AND (quantity_delta < 0)) OR (reason = ANY (ARRAY['adjustment'::text, 'count_correction'::text]))))
);

CREATE TABLE public.stock_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    name text NOT NULL,
    phone text,
    address text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE VIEW public.unpaid_bills WITH (security_invoker='true') AS
 SELECT b.id AS bill_id,
    b.clinic_id,
    b.visit_id,
    b.final_amount_paise,
    b.confirmed_at,
    v.token_number,
    v.arrived_at,
    p.name AS patient_name
   FROM ((public.bills b
     JOIN public.visits v ON ((v.id = b.visit_id)))
     JOIN public.patients p ON ((p.id = v.patient_id)))
  WHERE ((b.payment_method = 'pay_later'::text) AND (NOT (EXISTS ( SELECT 1
           FROM public.bill_settlements s
          WHERE (s.bill_id = b.id)))));

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    clinic_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_roles_role_check CHECK ((role = ANY (ARRAY['doctor'::text, 'receptionist'::text, 'admin'::text])))
);

CREATE TABLE public.visit_procedures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid NOT NULL,
    visit_id uuid NOT NULL,
    procedure_id uuid NOT NULL,
    price_paise bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visit_procedures_price_paise_check CHECK ((price_paise >= 0))
);

ALTER TABLE ONLY public.bill_line_items
    ADD CONSTRAINT bill_line_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bill_settlements
    ADD CONSTRAINT bill_settlements_bill_id_key UNIQUE (bill_id);

ALTER TABLE ONLY public.bill_settlements
    ADD CONSTRAINT bill_settlements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.clinic_documents
    ADD CONSTRAINT clinic_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.clinics
    ADD CONSTRAINT clinics_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.medicine_price_changes
    ADD CONSTRAINT medicine_price_changes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.medicine_stock
    ADD CONSTRAINT medicine_stock_medicine_id_stock_point_id_key UNIQUE (medicine_id, stock_point_id);

ALTER TABLE ONLY public.medicine_stock
    ADD CONSTRAINT medicine_stock_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.medicines
    ADD CONSTRAINT medicines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.patient_comments
    ADD CONSTRAINT patient_comments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.patient_field_definitions
    ADD CONSTRAINT patient_field_definitions_clinic_id_key_key UNIQUE (clinic_id, key);

ALTER TABLE ONLY public.patient_field_definitions
    ADD CONSTRAINT patient_field_definitions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pharma_rep_checkins
    ADD CONSTRAINT pharma_rep_checkins_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pharmacy_sale_items
    ADD CONSTRAINT pharmacy_sale_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pharmacy_sales
    ADD CONSTRAINT pharmacy_sales_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prescription_items
    ADD CONSTRAINT prescription_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prescription_template_items
    ADD CONSTRAINT prescription_template_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prescription_templates
    ADD CONSTRAINT prescription_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pricing_approvals
    ADD CONSTRAINT pricing_approvals_pkey PRIMARY KEY (visit_id, revision_number);

ALTER TABLE ONLY public.pricing_approvals
    ADD CONSTRAINT pricing_approvals_request_id_key UNIQUE (request_id);

ALTER TABLE ONLY public.procedures
    ADD CONSTRAINT procedures_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.queue_events
    ADD CONSTRAINT queue_events_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.stock_count_lines
    ADD CONSTRAINT stock_count_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stock_counts
    ADD CONSTRAINT stock_counts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stock_points
    ADD CONSTRAINT stock_points_clinic_id_name_key UNIQUE (clinic_id, name);

ALTER TABLE ONLY public.stock_points
    ADD CONSTRAINT stock_points_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_clinic_id_role_key UNIQUE (user_id, clinic_id, role);

ALTER TABLE ONLY public.visit_pricing
    ADD CONSTRAINT visit_pricing_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.visit_pricing
    ADD CONSTRAINT visit_pricing_visit_id_key UNIQUE (visit_id);

ALTER TABLE ONLY public.visit_procedures
    ADD CONSTRAINT visit_procedures_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_clinic_id_token_number_key UNIQUE (clinic_id, token_number);

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_pkey PRIMARY KEY (id);

CREATE INDEX bill_line_items_bill_id_idx ON public.bill_line_items USING btree (bill_id);

CREATE INDEX bill_settlements_clinic_id_idx ON public.bill_settlements USING btree (clinic_id);

CREATE INDEX bills_clinic_id_idx ON public.bills USING btree (clinic_id);

CREATE INDEX bills_corrects_bill_id_idx ON public.bills USING btree (corrects_bill_id);

CREATE UNIQUE INDEX bills_original_pharmacy_sale_idx ON public.bills USING btree (pharmacy_sale_id) WHERE (corrects_bill_id IS NULL);

CREATE INDEX bills_visit_id_idx ON public.bills USING btree (visit_id);

CREATE INDEX clinic_documents_clinic_id_idx ON public.clinic_documents USING btree (clinic_id);

CREATE INDEX clinic_documents_visit_id_idx ON public.clinic_documents USING btree (visit_id);

CREATE INDEX medicine_stock_clinic_id_idx ON public.medicine_stock USING btree (clinic_id);

CREATE INDEX medicines_clinic_id_idx ON public.medicines USING btree (clinic_id);

CREATE INDEX patient_comments_patient_id_idx ON public.patient_comments USING btree (patient_id);

CREATE INDEX patients_clinic_id_idx ON public.patients USING btree (clinic_id);

CREATE INDEX patients_name_trgm_idx ON public.patients USING gin (name extensions.gin_trgm_ops);

CREATE INDEX patients_phone_idx ON public.patients USING btree (phone text_pattern_ops);

CREATE INDEX pharma_rep_checkins_clinic_id_idx ON public.pharma_rep_checkins USING btree (clinic_id);

CREATE INDEX pharmacy_sale_items_sale_idx ON public.pharmacy_sale_items USING btree (sale_id);

CREATE INDEX pharmacy_sales_clinic_created_idx ON public.pharmacy_sales USING btree (clinic_id, created_at);

CREATE INDEX prescription_items_prescription_id_idx ON public.prescription_items USING btree (prescription_id);

CREATE INDEX prescription_template_items_template_id_idx ON public.prescription_template_items USING btree (template_id);

CREATE INDEX prescription_templates_clinic_id_idx ON public.prescription_templates USING btree (clinic_id);

CREATE INDEX prescriptions_clinic_id_idx ON public.prescriptions USING btree (clinic_id);

CREATE INDEX prescriptions_visit_id_idx ON public.prescriptions USING btree (visit_id);

CREATE INDEX procedures_clinic_id_idx ON public.procedures USING btree (clinic_id);

CREATE INDEX purchase_items_purchase_id_idx ON public.purchase_items USING btree (purchase_id);

CREATE INDEX purchases_clinic_id_idx ON public.purchases USING btree (clinic_id);

CREATE INDEX purchases_supplier_id_idx ON public.purchases USING btree (supplier_id);

CREATE INDEX stock_count_lines_stock_count_id_idx ON public.stock_count_lines USING btree (stock_count_id);

CREATE INDEX stock_counts_clinic_id_idx ON public.stock_counts USING btree (clinic_id);

CREATE INDEX stock_movements_clinic_id_idx ON public.stock_movements USING btree (clinic_id);

CREATE INDEX stock_movements_medicine_stock_point_idx ON public.stock_movements USING btree (medicine_id, stock_point_id);

CREATE INDEX suppliers_clinic_id_idx ON public.suppliers USING btree (clinic_id);

CREATE INDEX visit_pricing_clinic_id_idx ON public.visit_pricing USING btree (clinic_id);

CREATE INDEX visit_procedures_visit_id_idx ON public.visit_procedures USING btree (visit_id);

CREATE INDEX visits_clinic_arrived_idx ON public.visits USING btree (clinic_id, arrived_at);

CREATE INDEX visits_clinic_stage_idx ON public.visits USING btree (clinic_id, stage);

CREATE INDEX visits_patient_id_idx ON public.visits USING btree (patient_id);

CREATE TRIGGER trg_apply_stock_movement AFTER INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

CREATE TRIGGER trg_assign_token_number BEFORE INSERT ON public.visits FOR EACH ROW EXECUTE FUNCTION public.assign_token_number();

CREATE TRIGGER trg_audit_medicine_price AFTER UPDATE ON public.medicines FOR EACH ROW EXECUTE FUNCTION public.audit_medicine_price();

CREATE TRIGGER trg_bump_pricing_revision BEFORE UPDATE ON public.visit_pricing FOR EACH ROW EXECUTE FUNCTION public.bump_pricing_revision();

CREATE TRIGGER trg_confirm_legacy_prescription_units AFTER UPDATE OF unit_confirmed_at ON public.medicines FOR EACH ROW EXECUTE FUNCTION public.confirm_legacy_prescription_units();

CREATE TRIGGER trg_create_visit_pricing AFTER INSERT ON public.visits FOR EACH ROW EXECUTE FUNCTION public.create_visit_pricing();

CREATE TRIGGER trg_enforce_patient_long_term_authorship BEFORE UPDATE ON public.patients FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_long_term_authorship();

CREATE TRIGGER trg_enforce_visit_followup_authorship BEFORE UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.enforce_visit_followup_authorship();

CREATE TRIGGER trg_guard_dispensing_stock BEFORE INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.guard_dispensing_stock();

CREATE TRIGGER trg_guard_queue_write BEFORE UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.guard_queue_write();

CREATE TRIGGER trg_initialize_queue_position BEFORE INSERT ON public.visits FOR EACH ROW EXECUTE FUNCTION public.initialize_queue_position();

CREATE TRIGGER trg_recompute_pricing_from_prescription_items_del AFTER DELETE ON public.prescription_items REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_visit_pricing_from_prescription_items();

CREATE TRIGGER trg_recompute_pricing_from_prescription_items_ins AFTER INSERT ON public.prescription_items REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_visit_pricing_from_prescription_items();

CREATE TRIGGER trg_recompute_pricing_from_prescription_items_upd AFTER UPDATE ON public.prescription_items REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_visit_pricing_from_prescription_items();

CREATE TRIGGER trg_recompute_pricing_from_procedures_del AFTER DELETE ON public.visit_procedures REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_visit_pricing_from_procedures();

CREATE TRIGGER trg_recompute_pricing_from_procedures_ins AFTER INSERT ON public.visit_procedures REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_visit_pricing_from_procedures();

CREATE TRIGGER trg_recompute_pricing_from_procedures_upd AFTER UPDATE ON public.visit_procedures REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_visit_pricing_from_procedures();

CREATE TRIGGER trg_record_pricing_approval AFTER INSERT OR UPDATE ON public.visit_pricing FOR EACH ROW EXECUTE FUNCTION public.record_pricing_approval();

CREATE TRIGGER trg_reset_long_term_review_on_visit AFTER INSERT ON public.visits FOR EACH ROW EXECUTE FUNCTION public.reset_long_term_review_on_visit();

CREATE TRIGGER trg_set_bill_needs_reconciliation BEFORE INSERT ON public.bills FOR EACH ROW EXECUTE FUNCTION public.set_bill_needs_reconciliation();

CREATE TRIGGER trg_snapshot_prescription_price BEFORE INSERT OR UPDATE ON public.prescription_items FOR EACH ROW EXECUTE FUNCTION public.snapshot_prescription_price();

ALTER TABLE ONLY public.bill_line_items
    ADD CONSTRAINT bill_line_items_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id);

ALTER TABLE ONLY public.bill_line_items
    ADD CONSTRAINT bill_line_items_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.bill_line_items
    ADD CONSTRAINT bill_line_items_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines(id);

ALTER TABLE ONLY public.bill_line_items
    ADD CONSTRAINT bill_line_items_prescription_item_id_fkey FOREIGN KEY (prescription_item_id) REFERENCES public.prescription_items(id);

ALTER TABLE ONLY public.bill_line_items
    ADD CONSTRAINT bill_line_items_procedure_id_fkey FOREIGN KEY (procedure_id) REFERENCES public.procedures(id);

ALTER TABLE ONLY public.bill_settlements
    ADD CONSTRAINT bill_settlements_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id);

ALTER TABLE ONLY public.bill_settlements
    ADD CONSTRAINT bill_settlements_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.bill_settlements
    ADD CONSTRAINT bill_settlements_settled_by_fkey FOREIGN KEY (settled_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_corrects_bill_id_fkey FOREIGN KEY (corrects_bill_id) REFERENCES public.bills(id);

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_pharmacy_sale_id_fkey FOREIGN KEY (pharmacy_sale_id) REFERENCES public.pharmacy_sales(id);

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id);

ALTER TABLE ONLY public.clinic_documents
    ADD CONSTRAINT clinic_documents_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.clinic_documents
    ADD CONSTRAINT clinic_documents_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.clinic_documents
    ADD CONSTRAINT clinic_documents_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id);

ALTER TABLE ONLY public.medicine_price_changes
    ADD CONSTRAINT medicine_price_changes_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.medicine_price_changes
    ADD CONSTRAINT medicine_price_changes_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.medicine_price_changes
    ADD CONSTRAINT medicine_price_changes_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines(id);

ALTER TABLE ONLY public.medicine_stock
    ADD CONSTRAINT medicine_stock_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.medicine_stock
    ADD CONSTRAINT medicine_stock_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines(id);

ALTER TABLE ONLY public.medicine_stock
    ADD CONSTRAINT medicine_stock_stock_point_id_fkey FOREIGN KEY (stock_point_id) REFERENCES public.stock_points(id);

ALTER TABLE ONLY public.medicines
    ADD CONSTRAINT medicines_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.patient_comments
    ADD CONSTRAINT patient_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.patient_comments
    ADD CONSTRAINT patient_comments_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.patient_comments
    ADD CONSTRAINT patient_comments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);

ALTER TABLE ONLY public.patient_field_definitions
    ADD CONSTRAINT patient_field_definitions_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.pharma_rep_checkins
    ADD CONSTRAINT pharma_rep_checkins_checked_in_by_fkey FOREIGN KEY (checked_in_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.pharma_rep_checkins
    ADD CONSTRAINT pharma_rep_checkins_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.pharmacy_sale_items
    ADD CONSTRAINT pharmacy_sale_items_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.pharmacy_sale_items
    ADD CONSTRAINT pharmacy_sale_items_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines(id);

ALTER TABLE ONLY public.pharmacy_sale_items
    ADD CONSTRAINT pharmacy_sale_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.pharmacy_sales(id);

ALTER TABLE ONLY public.pharmacy_sales
    ADD CONSTRAINT pharmacy_sales_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id);

ALTER TABLE ONLY public.pharmacy_sales
    ADD CONSTRAINT pharmacy_sales_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.pharmacy_sales
    ADD CONSTRAINT pharmacy_sales_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.prescription_items
    ADD CONSTRAINT prescription_items_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.prescription_items
    ADD CONSTRAINT prescription_items_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines(id);

ALTER TABLE ONLY public.prescription_items
    ADD CONSTRAINT prescription_items_prescription_id_fkey FOREIGN KEY (prescription_id) REFERENCES public.prescriptions(id);

ALTER TABLE ONLY public.prescription_template_items
    ADD CONSTRAINT prescription_template_items_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.prescription_template_items
    ADD CONSTRAINT prescription_template_items_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines(id);

ALTER TABLE ONLY public.prescription_template_items
    ADD CONSTRAINT prescription_template_items_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.prescription_templates(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prescription_templates
    ADD CONSTRAINT prescription_templates_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id);

ALTER TABLE ONLY public.pricing_approvals
    ADD CONSTRAINT pricing_approvals_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.pricing_approvals
    ADD CONSTRAINT pricing_approvals_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.pricing_approvals
    ADD CONSTRAINT pricing_approvals_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id);

ALTER TABLE ONLY public.procedures
    ADD CONSTRAINT procedures_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines(id);

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id);

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_stock_point_id_fkey FOREIGN KEY (stock_point_id) REFERENCES public.stock_points(id);

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);

ALTER TABLE ONLY public.queue_events
    ADD CONSTRAINT queue_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.queue_events
    ADD CONSTRAINT queue_events_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.queue_events
    ADD CONSTRAINT queue_events_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id);

ALTER TABLE ONLY public.stock_count_lines
    ADD CONSTRAINT stock_count_lines_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.stock_count_lines
    ADD CONSTRAINT stock_count_lines_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines(id);

ALTER TABLE ONLY public.stock_count_lines
    ADD CONSTRAINT stock_count_lines_stock_count_id_fkey FOREIGN KEY (stock_count_id) REFERENCES public.stock_counts(id);

ALTER TABLE ONLY public.stock_counts
    ADD CONSTRAINT stock_counts_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.stock_counts
    ADD CONSTRAINT stock_counts_counted_by_fkey FOREIGN KEY (counted_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.stock_counts
    ADD CONSTRAINT stock_counts_stock_point_id_fkey FOREIGN KEY (stock_point_id) REFERENCES public.stock_points(id);

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines(id);

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_stock_point_id_fkey FOREIGN KEY (stock_point_id) REFERENCES public.stock_points(id);

ALTER TABLE ONLY public.stock_points
    ADD CONSTRAINT stock_points_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.visit_pricing
    ADD CONSTRAINT visit_pricing_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.visit_pricing
    ADD CONSTRAINT visit_pricing_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.visit_pricing
    ADD CONSTRAINT visit_pricing_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id);

ALTER TABLE ONLY public.visit_procedures
    ADD CONSTRAINT visit_procedures_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.visit_procedures
    ADD CONSTRAINT visit_procedures_procedure_id_fkey FOREIGN KEY (procedure_id) REFERENCES public.procedures(id);

ALTER TABLE ONLY public.visit_procedures
    ADD CONSTRAINT visit_procedures_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id);

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);

ALTER TABLE public.bill_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY bill_line_items_select ON public.bill_line_items FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.bill_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY bill_settlements_select ON public.bill_settlements FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY bills_select ON public.bills FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.clinic_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinic_documents_insert ON public.clinic_documents FOR INSERT WITH CHECK (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY clinic_documents_select ON public.clinic_documents FOR SELECT USING (public.has_clinic_role(clinic_id, 'doctor'::text));

ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinics_select ON public.clinics FOR SELECT USING (public.has_any_clinic_role(id));

ALTER TABLE public.medicine_price_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY medicine_price_changes_read ON public.medicine_price_changes FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.medicine_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY medicine_stock_select ON public.medicine_stock FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.medicines ENABLE ROW LEVEL SECURITY;

CREATE POLICY medicines_delete ON public.medicines FOR DELETE USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'admin'::text)));

CREATE POLICY medicines_insert ON public.medicines FOR INSERT WITH CHECK ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'admin'::text)));

CREATE POLICY medicines_select ON public.medicines FOR SELECT USING (public.has_any_clinic_role(clinic_id));

CREATE POLICY medicines_update ON public.medicines FOR UPDATE USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'admin'::text)));

ALTER TABLE public.patient_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY patient_comments_delete ON public.patient_comments FOR DELETE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY patient_comments_insert ON public.patient_comments FOR INSERT WITH CHECK (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY patient_comments_select ON public.patient_comments FOR SELECT USING (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY patient_comments_update ON public.patient_comments FOR UPDATE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

ALTER TABLE public.patient_field_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY patient_field_definitions_delete ON public.patient_field_definitions FOR DELETE USING (public.has_clinic_role(clinic_id, 'admin'::text));

CREATE POLICY patient_field_definitions_insert ON public.patient_field_definitions FOR INSERT WITH CHECK (public.has_clinic_role(clinic_id, 'admin'::text));

CREATE POLICY patient_field_definitions_select ON public.patient_field_definitions FOR SELECT USING (public.has_any_clinic_role(clinic_id));

CREATE POLICY patient_field_definitions_update ON public.patient_field_definitions FOR UPDATE USING (public.has_clinic_role(clinic_id, 'admin'::text));

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY patients_insert ON public.patients FOR INSERT WITH CHECK ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

CREATE POLICY patients_select ON public.patients FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

CREATE POLICY patients_update ON public.patients FOR UPDATE USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.pharma_rep_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY pharma_rep_checkins_insert ON public.pharma_rep_checkins FOR INSERT WITH CHECK (public.has_clinic_role(clinic_id, 'receptionist'::text));

CREATE POLICY pharma_rep_checkins_select ON public.pharma_rep_checkins FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

CREATE POLICY pharma_rep_checkins_update ON public.pharma_rep_checkins FOR UPDATE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

ALTER TABLE public.pharmacy_sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY pharmacy_sale_items_select ON public.pharmacy_sale_items FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.pharmacy_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY pharmacy_sales_select ON public.pharmacy_sales FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY prescription_items_delete ON public.prescription_items FOR DELETE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY prescription_items_insert ON public.prescription_items FOR INSERT WITH CHECK (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY prescription_items_select ON public.prescription_items FOR SELECT USING (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY prescription_items_update ON public.prescription_items FOR UPDATE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

ALTER TABLE public.prescription_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY prescription_template_items_delete ON public.prescription_template_items FOR DELETE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY prescription_template_items_insert ON public.prescription_template_items FOR INSERT WITH CHECK (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY prescription_template_items_select ON public.prescription_template_items FOR SELECT USING (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY prescription_template_items_update ON public.prescription_template_items FOR UPDATE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

ALTER TABLE public.prescription_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY prescription_templates_delete ON public.prescription_templates FOR DELETE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY prescription_templates_delete_admin ON public.prescription_templates FOR DELETE USING (public.has_clinic_role(clinic_id, 'admin'::text));

CREATE POLICY prescription_templates_insert ON public.prescription_templates FOR INSERT WITH CHECK (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY prescription_templates_select ON public.prescription_templates FOR SELECT USING (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY prescription_templates_select_admin ON public.prescription_templates FOR SELECT USING (public.has_clinic_role(clinic_id, 'admin'::text));

CREATE POLICY prescription_templates_update ON public.prescription_templates FOR UPDATE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY prescription_templates_update_admin ON public.prescription_templates FOR UPDATE USING (public.has_clinic_role(clinic_id, 'admin'::text));

ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY prescriptions_insert ON public.prescriptions FOR INSERT WITH CHECK (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY prescriptions_select ON public.prescriptions FOR SELECT USING (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY prescriptions_update ON public.prescriptions FOR UPDATE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

ALTER TABLE public.pricing_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY pricing_approvals_select ON public.pricing_approvals FOR SELECT USING (public.has_clinic_role(clinic_id, 'doctor'::text));

ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;

CREATE POLICY procedures_delete ON public.procedures FOR DELETE USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'admin'::text)));

CREATE POLICY procedures_insert ON public.procedures FOR INSERT WITH CHECK ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'admin'::text)));

CREATE POLICY procedures_select ON public.procedures FOR SELECT USING (public.has_any_clinic_role(clinic_id));

CREATE POLICY procedures_update ON public.procedures FOR UPDATE USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'admin'::text)));

ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY purchase_items_insert ON public.purchase_items FOR INSERT WITH CHECK ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

CREATE POLICY purchase_items_select ON public.purchase_items FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY purchases_insert ON public.purchases FOR INSERT WITH CHECK ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

CREATE POLICY purchases_select ON public.purchases FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.queue_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY queue_events_read ON public.queue_events FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_count_lines_insert ON public.stock_count_lines FOR INSERT WITH CHECK ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

CREATE POLICY stock_count_lines_select ON public.stock_count_lines FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_counts_insert ON public.stock_counts FOR INSERT WITH CHECK ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

CREATE POLICY stock_counts_select ON public.stock_counts FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_movements_insert ON public.stock_movements FOR INSERT WITH CHECK ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

CREATE POLICY stock_movements_select ON public.stock_movements FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.stock_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_points_select ON public.stock_points FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY suppliers_insert ON public.suppliers FOR INSERT WITH CHECK ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

CREATE POLICY suppliers_select ON public.suppliers FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

CREATE POLICY suppliers_update ON public.suppliers FOR UPDATE USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_roles_delete ON public.user_roles FOR DELETE USING (public.has_clinic_role(clinic_id, 'admin'::text));

CREATE POLICY user_roles_insert ON public.user_roles FOR INSERT WITH CHECK (public.has_clinic_role(clinic_id, 'admin'::text));

CREATE POLICY user_roles_select ON public.user_roles FOR SELECT USING (((user_id = auth.uid()) OR public.has_clinic_role(clinic_id, 'admin'::text)));

CREATE POLICY user_roles_update ON public.user_roles FOR UPDATE USING (public.has_clinic_role(clinic_id, 'admin'::text));

ALTER TABLE public.visit_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY visit_pricing_select ON public.visit_pricing FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

CREATE POLICY visit_pricing_update ON public.visit_pricing FOR UPDATE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

ALTER TABLE public.visit_procedures ENABLE ROW LEVEL SECURITY;

CREATE POLICY visit_procedures_delete ON public.visit_procedures FOR DELETE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY visit_procedures_insert ON public.visit_procedures FOR INSERT WITH CHECK (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY visit_procedures_select ON public.visit_procedures FOR SELECT USING (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY visit_procedures_update ON public.visit_procedures FOR UPDATE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY visits_insert ON public.visits FOR INSERT WITH CHECK ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

CREATE POLICY visits_select ON public.visits FOR SELECT USING ((public.has_clinic_role(clinic_id, 'doctor'::text) OR public.has_clinic_role(clinic_id, 'receptionist'::text)));

CREATE POLICY visits_update_doctor ON public.visits FOR UPDATE USING (public.has_clinic_role(clinic_id, 'doctor'::text));

CREATE POLICY visits_update_receptionist ON public.visits FOR UPDATE USING ((public.has_clinic_role(clinic_id, 'receptionist'::text) AND (stage <> 'paid'::text))) WITH CHECK (public.has_clinic_role(clinic_id, 'receptionist'::text));

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO backup_reader;

REVOKE ALL ON FUNCTION public.adjust_stock(p_clinic_id uuid, p_medicine_id uuid, p_stock_point_id uuid, p_quantity_delta integer, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.adjust_stock(p_clinic_id uuid, p_medicine_id uuid, p_stock_point_id uuid, p_quantity_delta integer, p_reason text) TO service_role;
GRANT ALL ON FUNCTION public.adjust_stock(p_clinic_id uuid, p_medicine_id uuid, p_stock_point_id uuid, p_quantity_delta integer, p_reason text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_clinic_contact_info(p_clinic_id uuid, p_address text, p_phone text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_clinic_contact_info(p_clinic_id uuid, p_address text, p_phone text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_clinic_contact_info(p_clinic_id uuid, p_address text, p_phone text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_set_clinic_doctor_info(p_clinic_id uuid, p_doctor_name text, p_doctor_registration_number text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_clinic_doctor_info(p_clinic_id uuid, p_doctor_name text, p_doctor_registration_number text) TO service_role;
GRANT ALL ON FUNCTION public.admin_set_clinic_doctor_info(p_clinic_id uuid, p_doctor_name text, p_doctor_registration_number text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_clinic_fee(p_clinic_id uuid, p_fee_paise bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_clinic_fee(p_clinic_id uuid, p_fee_paise bigint) TO service_role;
GRANT ALL ON FUNCTION public.admin_set_clinic_fee(p_clinic_id uuid, p_fee_paise bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_clinic_upi_vpa(p_clinic_id uuid, p_upi_vpa text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_clinic_upi_vpa(p_clinic_id uuid, p_upi_vpa text) TO service_role;
GRANT ALL ON FUNCTION public.admin_set_clinic_upi_vpa(p_clinic_id uuid, p_upi_vpa text) TO authenticated;

REVOKE ALL ON FUNCTION public.apply_stock_movement() FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_stock_movement() TO service_role;

REVOKE ALL ON FUNCTION public.approval_financial_lines(p_lines jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approval_financial_lines(p_lines jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.approve_visit_pricing(p_visit_id uuid, p_final_amount_paise bigint, p_expected_total_paise bigint, p_expected_revision_number bigint, p_request_id uuid, p_expected_lines jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_visit_pricing(p_visit_id uuid, p_final_amount_paise bigint, p_expected_total_paise bigint, p_expected_revision_number bigint, p_request_id uuid, p_expected_lines jsonb) TO service_role;
GRANT ALL ON FUNCTION public.approve_visit_pricing(p_visit_id uuid, p_final_amount_paise bigint, p_expected_total_paise bigint, p_expected_revision_number bigint, p_request_id uuid, p_expected_lines jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_token_number() FROM PUBLIC;
GRANT ALL ON FUNCTION public.assign_token_number() TO service_role;

REVOKE ALL ON FUNCTION public.audit_medicine_price() FROM PUBLIC;
GRANT ALL ON FUNCTION public.audit_medicine_price() TO service_role;

REVOKE ALL ON FUNCTION public.build_approval_lines(p_visit_id uuid, p_catalog_prices boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.build_approval_lines(p_visit_id uuid, p_catalog_prices boolean) TO service_role;

REVOKE ALL ON FUNCTION public.bump_pricing_revision() FROM PUBLIC;
GRANT ALL ON FUNCTION public.bump_pricing_revision() TO service_role;

REVOKE ALL ON FUNCTION public.confirm_bill(p_visit_id uuid, p_payment_method text, p_snapshot_final_amount_paise bigint, p_snapshot_revision_number bigint, p_supplied_items jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_bill(p_visit_id uuid, p_payment_method text, p_snapshot_final_amount_paise bigint, p_snapshot_revision_number bigint, p_supplied_items jsonb) TO service_role;
GRANT ALL ON FUNCTION public.confirm_bill(p_visit_id uuid, p_payment_method text, p_snapshot_final_amount_paise bigint, p_snapshot_revision_number bigint, p_supplied_items jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_legacy_prescription_units() FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_legacy_prescription_units() TO service_role;

REVOKE ALL ON FUNCTION public.confirm_pharmacy_sale(p_sale_id uuid, p_payment_method text, p_expected_amount_paise bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_pharmacy_sale(p_sale_id uuid, p_payment_method text, p_expected_amount_paise bigint) TO service_role;
GRANT ALL ON FUNCTION public.confirm_pharmacy_sale(p_sale_id uuid, p_payment_method text, p_expected_amount_paise bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.correct_bill(p_bill_id uuid, p_expected_amount_paise bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.correct_bill(p_bill_id uuid, p_expected_amount_paise bigint) TO service_role;
GRANT ALL ON FUNCTION public.correct_bill(p_bill_id uuid, p_expected_amount_paise bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.create_stock_transfer(p_clinic_id uuid, p_medicine_id uuid, p_from_stock_point_id uuid, p_to_stock_point_id uuid, p_quantity integer, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_stock_transfer(p_clinic_id uuid, p_medicine_id uuid, p_from_stock_point_id uuid, p_to_stock_point_id uuid, p_quantity integer, p_notes text) TO service_role;
GRANT ALL ON FUNCTION public.create_stock_transfer(p_clinic_id uuid, p_medicine_id uuid, p_from_stock_point_id uuid, p_to_stock_point_id uuid, p_quantity integer, p_notes text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_visit_pricing() FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_visit_pricing() TO service_role;

REVOKE ALL ON FUNCTION public.enforce_patient_long_term_authorship() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_patient_long_term_authorship() TO service_role;

REVOKE ALL ON FUNCTION public.enforce_visit_followup_authorship() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_visit_followup_authorship() TO service_role;

REVOKE ALL ON FUNCTION public.ensure_final_amount_set_on_packing() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_final_amount_set_on_packing() TO service_role;

REVOKE ALL ON FUNCTION public.get_approved_bill(p_visit_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_approved_bill(p_visit_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_approved_bill(p_visit_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_daily_report(p_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_daily_report(p_date date) TO service_role;
GRANT ALL ON FUNCTION public.get_daily_report(p_date date) TO authenticated;

REVOKE ALL ON FUNCTION public.get_gst_report(p_start_date date, p_end_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_gst_report(p_start_date date, p_end_date date) TO service_role;
GRANT ALL ON FUNCTION public.get_gst_report(p_start_date date, p_end_date date) TO authenticated;

REVOKE ALL ON FUNCTION public.get_monthly_report(p_months integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_monthly_report(p_months integer) TO service_role;
GRANT ALL ON FUNCTION public.get_monthly_report(p_months integer) TO authenticated;

REVOKE ALL ON FUNCTION public.get_pricing_proposal(p_visit_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_pricing_proposal(p_visit_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_pricing_proposal(p_visit_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_stock_warnings_report() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_stock_warnings_report() TO service_role;
GRANT ALL ON FUNCTION public.get_stock_warnings_report() TO authenticated;

REVOKE ALL ON FUNCTION public.get_visit_billing_detail(p_visit_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_visit_billing_detail(p_visit_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_visit_billing_detail(p_visit_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.guard_dispensing_stock() FROM PUBLIC;
GRANT ALL ON FUNCTION public.guard_dispensing_stock() TO service_role;

REVOKE ALL ON FUNCTION public.guard_queue_write() FROM PUBLIC;
GRANT ALL ON FUNCTION public.guard_queue_write() TO service_role;

REVOKE ALL ON FUNCTION public.has_any_clinic_role(p_clinic_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_any_clinic_role(p_clinic_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.has_any_clinic_role(p_clinic_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.has_clinic_role(p_clinic_id uuid, p_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_clinic_role(p_clinic_id uuid, p_role text) TO authenticated;
GRANT ALL ON FUNCTION public.has_clinic_role(p_clinic_id uuid, p_role text) TO service_role;

REVOKE ALL ON FUNCTION public.health_ping() FROM PUBLIC;
GRANT ALL ON FUNCTION public.health_ping() TO service_role;
GRANT ALL ON FUNCTION public.health_ping() TO anon;

REVOKE ALL ON FUNCTION public.initialize_queue_position() FROM PUBLIC;
GRANT ALL ON FUNCTION public.initialize_queue_position() TO service_role;

REVOKE ALL ON FUNCTION public.list_clinic_logins(p_clinic_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_clinic_logins(p_clinic_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.list_clinic_logins(p_clinic_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.mark_follow_up_done(p_visit_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_follow_up_done(p_visit_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.mark_follow_up_done(p_visit_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.merge_patients(p_patient_a uuid, p_patient_b uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merge_patients(p_patient_a uuid, p_patient_b uuid) TO authenticated;
GRANT ALL ON FUNCTION public.merge_patients(p_patient_a uuid, p_patient_b uuid) TO service_role;

REVOKE ALL ON FUNCTION public.queue_visit_action(p_visit_id uuid, p_action text, p_request_id uuid, p_reason text, p_occurred_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.queue_visit_action(p_visit_id uuid, p_action text, p_request_id uuid, p_reason text, p_occurred_at timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.queue_visit_action(p_visit_id uuid, p_action text, p_request_id uuid, p_reason text, p_occurred_at timestamp with time zone) TO authenticated;

REVOKE ALL ON FUNCTION public.recompute_visit_pricing(p_visit_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.recompute_visit_pricing(p_visit_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.recompute_visit_pricing_from_prescription_items() FROM PUBLIC;
GRANT ALL ON FUNCTION public.recompute_visit_pricing_from_prescription_items() TO service_role;

REVOKE ALL ON FUNCTION public.recompute_visit_pricing_from_procedures() FROM PUBLIC;
GRANT ALL ON FUNCTION public.recompute_visit_pricing_from_procedures() TO service_role;

REVOKE ALL ON FUNCTION public.record_pricing_approval() FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_pricing_approval() TO service_role;

REVOKE ALL ON FUNCTION public.record_purchase(p_clinic_id uuid, p_supplier_id uuid, p_invoice_number text, p_purchase_date date, p_stock_point_id uuid, p_items jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_purchase(p_clinic_id uuid, p_supplier_id uuid, p_invoice_number text, p_purchase_date date, p_stock_point_id uuid, p_items jsonb) TO service_role;
GRANT ALL ON FUNCTION public.record_purchase(p_clinic_id uuid, p_supplier_id uuid, p_invoice_number text, p_purchase_date date, p_stock_point_id uuid, p_items jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.record_stock_count(p_clinic_id uuid, p_stock_point_id uuid, p_lines jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_stock_count(p_clinic_id uuid, p_stock_point_id uuid, p_lines jsonb) TO service_role;
GRANT ALL ON FUNCTION public.record_stock_count(p_clinic_id uuid, p_stock_point_id uuid, p_lines jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.request_bill_discount(p_visit_id uuid, p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_bill_discount(p_visit_id uuid, p_request_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.request_bill_discount(p_visit_id uuid, p_request_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.reset_long_term_review_on_visit() FROM PUBLIC;
GRANT ALL ON FUNCTION public.reset_long_term_review_on_visit() TO service_role;

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;

REVOKE ALL ON FUNCTION public.save_pharmacy_sale(p_sale_id uuid, p_clinic_id uuid, p_customer_name text, p_items jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_pharmacy_sale(p_sale_id uuid, p_clinic_id uuid, p_customer_name text, p_items jsonb) TO service_role;
GRANT ALL ON FUNCTION public.save_pharmacy_sale(p_sale_id uuid, p_clinic_id uuid, p_customer_name text, p_items jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.save_prescription(p_prescription_id uuid, p_visit_id uuid, p_items jsonb, p_diagnosis text, p_advice text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_prescription(p_prescription_id uuid, p_visit_id uuid, p_items jsonb, p_diagnosis text, p_advice text) TO service_role;
GRANT ALL ON FUNCTION public.save_prescription(p_prescription_id uuid, p_visit_id uuid, p_items jsonb, p_diagnosis text, p_advice text) TO authenticated;

REVOKE ALL ON FUNCTION public.search_patients(p_clinic_id uuid, p_query text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.search_patients(p_clinic_id uuid, p_query text) TO authenticated;
GRANT ALL ON FUNCTION public.search_patients(p_clinic_id uuid, p_query text) TO service_role;

REVOKE ALL ON FUNCTION public.set_bill_needs_reconciliation() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_bill_needs_reconciliation() TO service_role;

REVOKE ALL ON FUNCTION public.set_medicine_unit_price(p_medicine_id uuid, p_stock_unit text, p_price_paise bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_medicine_unit_price(p_medicine_id uuid, p_stock_unit text, p_price_paise bigint) TO service_role;
GRANT ALL ON FUNCTION public.set_medicine_unit_price(p_medicine_id uuid, p_stock_unit text, p_price_paise bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.set_no_show_minutes(p_clinic_id uuid, p_minutes integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_no_show_minutes(p_clinic_id uuid, p_minutes integer) TO service_role;
GRANT ALL ON FUNCTION public.set_no_show_minutes(p_clinic_id uuid, p_minutes integer) TO authenticated;

REVOKE ALL ON FUNCTION public.set_patient_long_term(p_patient_id uuid, p_is_long_term boolean, p_review_interval_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_patient_long_term(p_patient_id uuid, p_is_long_term boolean, p_review_interval_days integer) TO service_role;
GRANT ALL ON FUNCTION public.set_patient_long_term(p_patient_id uuid, p_is_long_term boolean, p_review_interval_days integer) TO authenticated;

REVOKE ALL ON FUNCTION public.set_pharmacy_sale_amount(p_sale_id uuid, p_final_amount_paise bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_pharmacy_sale_amount(p_sale_id uuid, p_final_amount_paise bigint) TO service_role;
GRANT ALL ON FUNCTION public.set_pharmacy_sale_amount(p_sale_id uuid, p_final_amount_paise bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.set_visit_follow_up(p_visit_id uuid, p_follow_up_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_visit_follow_up(p_visit_id uuid, p_follow_up_date date) TO service_role;
GRANT ALL ON FUNCTION public.set_visit_follow_up(p_visit_id uuid, p_follow_up_date date) TO authenticated;

REVOKE ALL ON FUNCTION public.settle_bill(p_bill_id uuid, p_payment_method text, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_bill(p_bill_id uuid, p_payment_method text, p_notes text) TO service_role;
GRANT ALL ON FUNCTION public.settle_bill(p_bill_id uuid, p_payment_method text, p_notes text) TO authenticated;

REVOKE ALL ON FUNCTION public.snapshot_prescription_price() FROM PUBLIC;
GRANT ALL ON FUNCTION public.snapshot_prescription_price() TO service_role;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.bill_line_items TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.bill_line_items TO authenticated;
GRANT ALL ON TABLE public.bill_line_items TO service_role;
GRANT SELECT ON TABLE public.bill_line_items TO backup_reader;

GRANT ALL ON TABLE public.bill_settlements TO anon;
GRANT ALL ON TABLE public.bill_settlements TO authenticated;
GRANT ALL ON TABLE public.bill_settlements TO service_role;
GRANT SELECT ON TABLE public.bill_settlements TO backup_reader;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.bills TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.bills TO authenticated;
GRANT ALL ON TABLE public.bills TO service_role;
GRANT SELECT ON TABLE public.bills TO backup_reader;

GRANT ALL ON TABLE public.patients TO anon;
GRANT ALL ON TABLE public.patients TO authenticated;
GRANT ALL ON TABLE public.patients TO service_role;
GRANT SELECT ON TABLE public.patients TO backup_reader;

GRANT ALL ON TABLE public.visit_pricing TO anon;
GRANT ALL ON TABLE public.visit_pricing TO authenticated;
GRANT ALL ON TABLE public.visit_pricing TO service_role;
GRANT SELECT ON TABLE public.visit_pricing TO backup_reader;

GRANT ALL ON TABLE public.visits TO anon;
GRANT ALL ON TABLE public.visits TO authenticated;
GRANT ALL ON TABLE public.visits TO service_role;
GRANT SELECT ON TABLE public.visits TO backup_reader;

GRANT ALL ON TABLE public.bills_needing_reconciliation TO anon;
GRANT ALL ON TABLE public.bills_needing_reconciliation TO authenticated;
GRANT ALL ON TABLE public.bills_needing_reconciliation TO service_role;
GRANT SELECT ON TABLE public.bills_needing_reconciliation TO backup_reader;

GRANT ALL ON TABLE public.clinic_documents TO anon;
GRANT ALL ON TABLE public.clinic_documents TO authenticated;
GRANT ALL ON TABLE public.clinic_documents TO service_role;
GRANT SELECT ON TABLE public.clinic_documents TO backup_reader;

GRANT ALL ON TABLE public.clinics TO anon;
GRANT ALL ON TABLE public.clinics TO authenticated;
GRANT ALL ON TABLE public.clinics TO service_role;
GRANT SELECT ON TABLE public.clinics TO backup_reader;

GRANT ALL ON TABLE public.long_term_register TO anon;
GRANT ALL ON TABLE public.long_term_register TO authenticated;
GRANT ALL ON TABLE public.long_term_register TO service_role;
GRANT SELECT ON TABLE public.long_term_register TO backup_reader;

GRANT ALL ON TABLE public.medicine_price_changes TO service_role;
GRANT SELECT ON TABLE public.medicine_price_changes TO backup_reader;
GRANT SELECT ON TABLE public.medicine_price_changes TO authenticated;

GRANT ALL ON TABLE public.medicine_stock TO anon;
GRANT ALL ON TABLE public.medicine_stock TO authenticated;
GRANT ALL ON TABLE public.medicine_stock TO service_role;
GRANT SELECT ON TABLE public.medicine_stock TO backup_reader;

GRANT ALL ON TABLE public.medicines TO anon;
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.medicines TO authenticated;
GRANT ALL ON TABLE public.medicines TO service_role;
GRANT SELECT ON TABLE public.medicines TO backup_reader;

GRANT INSERT(id) ON TABLE public.medicines TO authenticated;

GRANT INSERT(clinic_id) ON TABLE public.medicines TO authenticated;

GRANT INSERT(name),UPDATE(name) ON TABLE public.medicines TO authenticated;

GRANT INSERT(price_paise),UPDATE(price_paise) ON TABLE public.medicines TO authenticated;

GRANT INSERT(drug_type),UPDATE(drug_type) ON TABLE public.medicines TO authenticated;

GRANT INSERT(strength_options),UPDATE(strength_options) ON TABLE public.medicines TO authenticated;

GRANT INSERT(low_stock_threshold),UPDATE(low_stock_threshold) ON TABLE public.medicines TO authenticated;

GRANT INSERT(expiry_date),UPDATE(expiry_date) ON TABLE public.medicines TO authenticated;

GRANT ALL ON TABLE public.patient_comments TO anon;
GRANT ALL ON TABLE public.patient_comments TO authenticated;
GRANT ALL ON TABLE public.patient_comments TO service_role;
GRANT SELECT ON TABLE public.patient_comments TO backup_reader;

GRANT ALL ON TABLE public.patient_field_definitions TO anon;
GRANT ALL ON TABLE public.patient_field_definitions TO authenticated;
GRANT ALL ON TABLE public.patient_field_definitions TO service_role;
GRANT SELECT ON TABLE public.patient_field_definitions TO backup_reader;

GRANT ALL ON TABLE public.pharma_rep_checkins TO anon;
GRANT ALL ON TABLE public.pharma_rep_checkins TO authenticated;
GRANT ALL ON TABLE public.pharma_rep_checkins TO service_role;
GRANT SELECT ON TABLE public.pharma_rep_checkins TO backup_reader;

GRANT ALL ON TABLE public.pharmacy_sale_items TO service_role;
GRANT SELECT ON TABLE public.pharmacy_sale_items TO backup_reader;
GRANT SELECT ON TABLE public.pharmacy_sale_items TO authenticated;

GRANT ALL ON TABLE public.pharmacy_sales TO service_role;
GRANT SELECT ON TABLE public.pharmacy_sales TO backup_reader;
GRANT SELECT ON TABLE public.pharmacy_sales TO authenticated;

GRANT ALL ON TABLE public.prescription_items TO anon;
GRANT ALL ON TABLE public.prescription_items TO authenticated;
GRANT ALL ON TABLE public.prescription_items TO service_role;
GRANT SELECT ON TABLE public.prescription_items TO backup_reader;

GRANT ALL ON TABLE public.prescription_template_items TO anon;
GRANT ALL ON TABLE public.prescription_template_items TO authenticated;
GRANT ALL ON TABLE public.prescription_template_items TO service_role;
GRANT SELECT ON TABLE public.prescription_template_items TO backup_reader;

GRANT ALL ON TABLE public.prescription_templates TO anon;
GRANT ALL ON TABLE public.prescription_templates TO authenticated;
GRANT ALL ON TABLE public.prescription_templates TO service_role;
GRANT SELECT ON TABLE public.prescription_templates TO backup_reader;

GRANT ALL ON TABLE public.prescriptions TO anon;
GRANT ALL ON TABLE public.prescriptions TO authenticated;
GRANT ALL ON TABLE public.prescriptions TO service_role;
GRANT SELECT ON TABLE public.prescriptions TO backup_reader;

GRANT ALL ON TABLE public.pricing_approvals TO service_role;
GRANT SELECT ON TABLE public.pricing_approvals TO backup_reader;
GRANT SELECT ON TABLE public.pricing_approvals TO authenticated;

GRANT ALL ON TABLE public.procedures TO anon;
GRANT ALL ON TABLE public.procedures TO authenticated;
GRANT ALL ON TABLE public.procedures TO service_role;
GRANT SELECT ON TABLE public.procedures TO backup_reader;

GRANT ALL ON TABLE public.purchase_items TO anon;
GRANT ALL ON TABLE public.purchase_items TO authenticated;
GRANT ALL ON TABLE public.purchase_items TO service_role;
GRANT SELECT ON TABLE public.purchase_items TO backup_reader;

GRANT ALL ON TABLE public.purchases TO anon;
GRANT ALL ON TABLE public.purchases TO authenticated;
GRANT ALL ON TABLE public.purchases TO service_role;
GRANT SELECT ON TABLE public.purchases TO backup_reader;

GRANT ALL ON TABLE public.queue_events TO service_role;
GRANT SELECT ON TABLE public.queue_events TO backup_reader;
GRANT SELECT ON TABLE public.queue_events TO authenticated;

GRANT ALL ON TABLE public.stock_count_lines TO anon;
GRANT ALL ON TABLE public.stock_count_lines TO authenticated;
GRANT ALL ON TABLE public.stock_count_lines TO service_role;
GRANT SELECT ON TABLE public.stock_count_lines TO backup_reader;

GRANT ALL ON TABLE public.stock_counts TO anon;
GRANT ALL ON TABLE public.stock_counts TO authenticated;
GRANT ALL ON TABLE public.stock_counts TO service_role;
GRANT SELECT ON TABLE public.stock_counts TO backup_reader;

GRANT ALL ON TABLE public.stock_movements TO anon;
GRANT ALL ON TABLE public.stock_movements TO authenticated;
GRANT ALL ON TABLE public.stock_movements TO service_role;
GRANT SELECT ON TABLE public.stock_movements TO backup_reader;

GRANT ALL ON TABLE public.stock_points TO anon;
GRANT ALL ON TABLE public.stock_points TO authenticated;
GRANT ALL ON TABLE public.stock_points TO service_role;
GRANT SELECT ON TABLE public.stock_points TO backup_reader;

GRANT ALL ON TABLE public.suppliers TO anon;
GRANT ALL ON TABLE public.suppliers TO authenticated;
GRANT ALL ON TABLE public.suppliers TO service_role;
GRANT SELECT ON TABLE public.suppliers TO backup_reader;

GRANT ALL ON TABLE public.unpaid_bills TO anon;
GRANT ALL ON TABLE public.unpaid_bills TO authenticated;
GRANT ALL ON TABLE public.unpaid_bills TO service_role;
GRANT SELECT ON TABLE public.unpaid_bills TO backup_reader;

GRANT ALL ON TABLE public.user_roles TO anon;
GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;
GRANT SELECT ON TABLE public.user_roles TO backup_reader;

GRANT ALL ON TABLE public.visit_procedures TO anon;
GRANT ALL ON TABLE public.visit_procedures TO authenticated;
GRANT ALL ON TABLE public.visit_procedures TO service_role;
GRANT SELECT ON TABLE public.visit_procedures TO backup_reader;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON SEQUENCES TO backup_reader;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO backup_reader;

$clinic_schema$;
 set local check_function_bodies = true;
 -- Realtime publication membership is outside a public-schema dump.
 alter publication supabase_realtime add table public.visits, public.visit_pricing, public.bills, public.pharmacy_sales;
 insert into public.clinics(name) values('Salem Pain & Palliative Care Clinic');
 insert into public.stock_points(clinic_id,name)
 select c.id,p.name from public.clinics c cross join (values('Counter'),('Storeroom')) p(name);
end
$bootstrap$;
