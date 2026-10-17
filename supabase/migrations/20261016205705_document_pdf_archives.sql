-- Durable, immutable issued-document snapshots. Google is never called in a bill transaction.
create table public.document_archives (
 id uuid primary key default gen_random_uuid(),
 clinic_id uuid not null references public.clinics(id),
 visit_id uuid references public.visits(id), bill_id uuid references public.bills(id),
 kind text not null check(kind in ('prescription','receipt')),
 source_id uuid not null, source_version bigint not null,
 snapshot jsonb not null,
 status text not null default 'pending' check(status in ('pending','ready')),
 drive_file_id text unique, content_sha256 text, size_bytes bigint,
 lease_id uuid, lease_until timestamptz, last_error text,
 created_at timestamptz not null default now(), ready_at timestamptz,
 unique(kind,source_id,source_version),
 check((kind='prescription' and visit_id=source_id and bill_id is null) or (kind='receipt' and bill_id=source_id))
);
create index document_archives_pending on public.document_archives(clinic_id,created_at) where status='pending';
create index document_archives_visit on public.document_archives(visit_id);
alter table public.document_archives enable row level security;
revoke all on public.document_archives from anon,authenticated;
grant select on public.document_archives to authenticated;
grant all on public.document_archives to service_role;
create policy document_archives_read on public.document_archives for select to authenticated using(
 public.has_clinic_role(clinic_id,'doctor') or (kind='receipt' and public.has_clinic_role(clinic_id,'receptionist'))
);

create function public.archive_clinic_snapshot(p_clinic_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',c.name,'upi_vpa',c.upi_vpa,'doctor_name',c.doctor_name,'doctor_registration_number',c.doctor_registration_number,'address',c.address,'phone',c.phone) from public.clinics c where c.id=p_clinic_id;
$$;
create function public.archive_visit_snapshot(p_visit_id uuid,p_clinical boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',v.id,'token_number',v.token_number,'stage',v.stage,'arrived_at',v.arrived_at,'patients',jsonb_build_object('name',p.name,'age',p.age,'gender',p.gender,'height_cm',p.height_cm,'weight_kg',p.weight_kg))
 || case when p_clinical then jsonb_build_object('complaint',v.complaint,'diagnosis',(select string_agg(distinct pr.diagnosis,E'\n') from public.prescriptions pr where pr.visit_id=v.id),'advice',(select string_agg(distinct pr.advice,E'\n') from public.prescriptions pr where pr.visit_id=v.id),'follow_up_date',v.follow_up_date) else '{}'::jsonb end
 from public.visits v join public.patients p on p.id=v.patient_id where v.id=p_visit_id;
$$;
create function public.enqueue_prescription_archive() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.pricing_approvals; medicines jsonb;
begin
 if new.stage='ready_to_bill' and old.stage is distinct from new.stage then
  select pa.* into a from public.pricing_approvals pa join public.visit_pricing vp on vp.visit_id=pa.visit_id and vp.revision_number=pa.revision_number where pa.visit_id=new.id;
  if a.visit_id is null then raise exception 'approved prescription required for archive'; end if;
  select coalesce(jsonb_agg(line),'[]'::jsonb) into medicines from jsonb_array_elements(a.lines) line where line->>'kind'='medicine';
  insert into public.document_archives(clinic_id,visit_id,kind,source_id,source_version,snapshot)
  values(new.clinic_id,new.id,'prescription',new.id,a.revision_number,jsonb_build_object('kind','prescription','clinic',public.archive_clinic_snapshot(new.clinic_id),'visit',public.archive_visit_snapshot(new.id,true),'medicines',medicines)) on conflict(kind,source_id,source_version) do nothing;
 end if; return new;
end; $$;
create trigger enqueue_prescription_archive after update of stage on public.visits for each row execute function public.enqueue_prescription_archive();

create function public.enqueue_receipt_archive() returns trigger language plpgsql security definer set search_path='' as $$
declare b public.bills; s public.bill_settlements; lines jsonb; subtotal bigint; customer text;
begin
 if tg_table_name='bills' then select * into b from public.bills where id=new.id;
 else select * into b from public.bills where id=new.bill_id; end if;
 select * into s from public.bill_settlements where bill_id=b.id;
 if b.payment_method='pay_later' and s.id is null then return new; end if;
 select coalesce(jsonb_agg(jsonb_build_object('kind',li.kind,'description',li.description,'quantity',li.quantity,'stock_unit',li.stock_unit,'unit_price_paise',li.unit_price_paise,'line_total_paise',li.line_total_paise,'approved_quantity',li.approved_quantity,'shortfall',li.shortfall) order by li.id),'[]'::jsonb),coalesce(sum(li.line_total_paise),0) into lines,subtotal from public.bill_line_items li where li.bill_id=b.id;
 select ps.customer_name into customer from public.pharmacy_sales ps where ps.id=b.pharmacy_sale_id;
 insert into public.document_archives(clinic_id,visit_id,bill_id,kind,source_id,source_version,snapshot)
 values(b.clinic_id,b.visit_id,b.id,'receipt',b.id,1,jsonb_build_object('kind','receipt','clinic',public.archive_clinic_snapshot(b.clinic_id),'visit',public.archive_visit_snapshot(b.visit_id,false),'customerName',customer,'billable',lines,'amountPaise',b.final_amount_paise,'discountPaise',greatest(0,subtotal-b.final_amount_paise),'correctsBillId',b.corrects_bill_id,'bill',jsonb_build_object('id',b.id,'final_amount_paise',b.final_amount_paise,'payment_method',coalesce(s.payment_method,b.payment_method),'confirmed_at',coalesce(s.settled_at,b.confirmed_at)))) on conflict(kind,source_id,source_version) do nothing;
 return new;
end; $$;
-- Deferred until immutable bill lines have been inserted by confirmation/correction.
create constraint trigger enqueue_receipt_archive after insert on public.bills deferrable initially deferred for each row execute function public.enqueue_receipt_archive();
create constraint trigger enqueue_settlement_archive after insert on public.bill_settlements deferrable initially deferred for each row execute function public.enqueue_receipt_archive();

create function public.claim_document_archive(p_id uuid,p_lease_id uuid) returns setof public.document_archives language sql security definer set search_path='' as $$
 update public.document_archives set lease_id=p_lease_id,lease_until=now()+interval '10 minutes',last_error=null where id=p_id and status='pending' and (lease_until is null or lease_until<now()) returning *;
$$;
revoke execute on function public.archive_clinic_snapshot(uuid),public.archive_visit_snapshot(uuid,boolean),public.enqueue_prescription_archive(),public.enqueue_receipt_archive(),public.claim_document_archive(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_document_archive(uuid,uuid) to service_role;
