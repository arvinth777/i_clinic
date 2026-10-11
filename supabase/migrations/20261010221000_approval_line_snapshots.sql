-- Catalog history is append-only and shares the catalog's clinic/role boundary.
create table public.medicine_price_changes (
 id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id),
 medicine_id uuid not null references public.medicines(id), old_price_paise bigint not null, new_price_paise bigint not null,
 changed_by uuid references auth.users(id), changed_at timestamptz not null default now()
);
alter table public.medicine_price_changes enable row level security;
create policy medicine_price_changes_read on public.medicine_price_changes for select using(public.has_clinic_role(clinic_id,'doctor') or public.has_clinic_role(clinic_id,'receptionist'));
revoke all on public.medicine_price_changes from anon,authenticated;
grant select on public.medicine_price_changes to authenticated;
create function public.audit_medicine_price() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.price_paise is distinct from old.price_paise then
  insert into public.medicine_price_changes(clinic_id,medicine_id,old_price_paise,new_price_paise,changed_by) values(new.clinic_id,new.id,old.price_paise,new.price_paise,auth.uid());
 end if; return new;
end; $$;
revoke execute on function public.audit_medicine_price() from public,anon,authenticated;
create trigger trg_audit_medicine_price after update on public.medicines for each row execute function public.audit_medicine_price();

alter table public.pricing_approvals add column lines jsonb, add column discount_paise bigint check(discount_paise>=0),
 add column approved_by uuid references auth.users(id), add column request_id uuid unique,
 add column request_payload jsonb;

-- Internal canonical line builder; old approvals use their original prescription prices.
create function public.build_approval_lines(p_visit_id uuid,p_catalog_prices boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform 1 from public.medicines m where id in (select pi.medicine_id from public.prescription_items pi join public.prescriptions p on p.id=pi.prescription_id where p.visit_id=p_visit_id) order by id for share;
 select jsonb_agg(line order by sort_key) into result from (
  select '0' as sort_key, jsonb_build_object('kind','consultation','description','Consultation','quantity',1,'unit_price_paise',c.consultation_fee_paise,'line_total_paise',c.consultation_fee_paise,'diagnosis',null,'advice',null) as line
    from public.visits v join public.clinics c on c.id=v.clinic_id where v.id=p_visit_id
  union all
  select '1'||vp.id::text,jsonb_build_object('kind','procedure','procedure_id',vp.procedure_id,'description',p.name,'quantity',1,'unit_price_paise',vp.price_paise,'line_total_paise',vp.price_paise,'diagnosis',null,'advice',null)
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
revoke execute on function public.build_approval_lines(uuid,boolean) from public,anon,authenticated;

-- Only the latest legacy approval can be reconstructed; older queued revisions need review.
update public.pricing_approvals a set lines=public.build_approval_lines(a.visit_id,false),discount_paise=vp.discount_paise
from public.visit_pricing vp join public.visits v on v.id=vp.visit_id
where a.visit_id=vp.visit_id and a.revision_number=vp.revision_number and v.stage<>'paid' and vp.final_amount_set;

create or replace function public.bump_pricing_revision() returns trigger language plpgsql security definer set search_path='' as $$
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
revoke execute on function public.bump_pricing_revision() from public,anon,authenticated;

create or replace function public.record_pricing_approval() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.final_amount_set then
  insert into public.pricing_approvals(clinic_id,visit_id,revision_number,final_amount_paise,lines,discount_paise,approved_by)
  values(new.clinic_id,new.visit_id,new.revision_number,new.final_amount_paise,case when tg_op='UPDATE' and old.final_amount_set then (select a.lines from public.pricing_approvals a where a.visit_id=old.visit_id and a.revision_number=old.revision_number) else public.build_approval_lines(new.visit_id) end,new.calculated_total_paise-new.final_amount_paise,auth.uid());
 end if; return new;
end; $$;
revoke execute on function public.record_pricing_approval() from public,anon,authenticated;

create function public.get_pricing_proposal(p_visit_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
revoke execute on function public.get_pricing_proposal(uuid) from public,anon,authenticated;
grant execute on function public.get_pricing_proposal(uuid) to authenticated;

create function public.approve_visit_pricing(p_visit_id uuid,p_final_amount_paise bigint,p_expected_total_paise bigint,p_expected_revision_number bigint,p_request_id uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare c uuid; proposal jsonb; existing public.pricing_approvals; revision bigint; payload jsonb;
begin
 select clinic_id into c from public.visits where id=p_visit_id for update;
 if c is null or not public.has_clinic_role(c,'doctor') then raise exception 'doctor required'; end if;
 if p_request_id is null then raise exception 'request ID required'; end if;
 payload:=jsonb_build_object('visit',p_visit_id,'final',p_final_amount_paise,'total',p_expected_total_paise,'revision',p_expected_revision_number);
 select * into existing from public.pricing_approvals where request_id=p_request_id;
 if found then
  if existing.approved_by<>auth.uid() or existing.request_payload<>payload then raise exception 'request ID already used'; end if;
  return existing.revision_number;
 end if;
 if exists(select 1 from public.visits where id=p_visit_id and stage in ('paid','no_show')) then raise exception 'use the correction workflow for a closed bill'; end if;
 perform 1 from public.visit_pricing where visit_id=p_visit_id for update;
 proposal:=public.get_pricing_proposal(p_visit_id);
 if p_expected_total_paise is distinct from (proposal->>'total_paise')::bigint or p_expected_revision_number is distinct from (proposal->>'revision_number')::bigint then raise exception 'prices or prescription changed; review the refreshed total'; end if;
 if p_final_amount_paise is null or p_final_amount_paise<0 or p_final_amount_paise>p_expected_total_paise then raise exception 'invalid final amount'; end if;
 update public.visit_pricing set final_amount_paise=p_final_amount_paise where visit_id=p_visit_id returning revision_number into revision;
 update public.pricing_approvals set request_id=p_request_id,request_payload=payload where visit_id=p_visit_id and revision_number=revision;
 return revision;
end; $$;
revoke execute on function public.approve_visit_pricing(uuid,bigint,bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function public.approve_visit_pricing(uuid,bigint,bigint,bigint,uuid) to authenticated;

create function public.get_approved_bill(p_visit_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.visits; a public.pricing_approvals; result jsonb;
begin
 select * into v from public.visits where id=p_visit_id;
 if v.id is null or not (public.has_clinic_role(v.clinic_id,'doctor') or (public.has_clinic_role(v.clinic_id,'receptionist') and v.stage in ('ready_to_bill','paid'))) then raise exception 'issued bill access required'; end if;
 select pa.* into a from public.pricing_approvals pa join public.visit_pricing vp on vp.visit_id=pa.visit_id and vp.revision_number=pa.revision_number
 where pa.visit_id=v.id and vp.final_amount_set;
 if a.lines is null then return null; end if;
 select jsonb_agg(l || jsonb_build_object('available_quantity',coalesce(s.quantity,0))) into result from jsonb_array_elements(a.lines) l
 left join public.stock_points sp on sp.clinic_id=v.clinic_id and sp.name='Counter'
 left join public.medicine_stock s on s.stock_point_id=sp.id and s.medicine_id=(l->>'medicine_id')::uuid;
 return jsonb_build_object('lines',result,'revision_number',a.revision_number,'final_amount_paise',a.final_amount_paise,'discount_paise',a.discount_paise);
end; $$;
revoke execute on function public.get_approved_bill(uuid) from public,anon,authenticated;
grant execute on function public.get_approved_bill(uuid) to authenticated;
