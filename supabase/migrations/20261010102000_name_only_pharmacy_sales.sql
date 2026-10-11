-- A pharmacy sale has no patient, prescription, visit, token or consultation fee.
create table public.pharmacy_sales (
  id uuid primary key,
  clinic_id uuid not null references public.clinics(id),
  customer_name text not null check (length(btrim(customer_name)) between 1 and 200),
  final_amount_paise bigint not null check (final_amount_paise >= 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  bill_id uuid references public.bills(id)
);
create table public.pharmacy_sale_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  sale_id uuid not null references public.pharmacy_sales(id),
  medicine_id uuid not null references public.medicines(id),
  description text not null,
  quantity int not null check (quantity > 0),
  stock_unit text not null,
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  line_total_paise bigint generated always as (quantity::bigint * unit_price_paise) stored
);
create index pharmacy_sales_clinic_created_idx on public.pharmacy_sales (clinic_id, created_at);
create index pharmacy_sale_items_sale_idx on public.pharmacy_sale_items (sale_id);
alter table public.pharmacy_sales enable row level security;
alter table public.pharmacy_sale_items enable row level security;
create policy pharmacy_sales_select on public.pharmacy_sales for select using (
  public.has_clinic_role(clinic_id, 'doctor') or public.has_clinic_role(clinic_id, 'receptionist'));
create policy pharmacy_sale_items_select on public.pharmacy_sale_items for select using (
  public.has_clinic_role(clinic_id, 'doctor') or public.has_clinic_role(clinic_id, 'receptionist'));
revoke all on public.pharmacy_sales, public.pharmacy_sale_items from anon, authenticated;
grant select on public.pharmacy_sales, public.pharmacy_sale_items to authenticated;

alter table public.bills alter column visit_id drop not null;
alter table public.bills add column pharmacy_sale_id uuid references public.pharmacy_sales(id);
alter table public.bills add constraint bill_has_one_source check ((visit_id is null) <> (pharmacy_sale_id is null));
create unique index bills_original_pharmacy_sale_idx on public.bills (pharmacy_sale_id) where corrects_bill_id is null;

create or replace function public.set_bill_needs_reconciliation()
returns trigger language plpgsql set search_path = '' as $$
declare v_current_revision bigint;
begin
  if new.visit_id is null then new.needs_reconciliation := false; return new; end if;
  select revision_number into v_current_revision from public.visit_pricing where visit_id = new.visit_id;
  new.needs_reconciliation := (v_current_revision is distinct from new.pricing_revision_at_confirm);
  return new;
end;
$$;
revoke execute on function public.set_bill_needs_reconciliation() from public, anon, authenticated;

create function public.save_pharmacy_sale(p_sale_id uuid, p_clinic_id uuid, p_customer_name text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
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
revoke execute on function public.save_pharmacy_sale(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_pharmacy_sale(uuid, uuid, text, jsonb) to authenticated;

-- Row locking serializes payment, retries and doctor discounts for this sale.
create function public.confirm_pharmacy_sale(p_sale_id uuid, p_payment_method text, p_expected_amount_paise bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
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
revoke execute on function public.confirm_pharmacy_sale(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.confirm_pharmacy_sale(uuid, text, bigint) to authenticated;

-- A correction appends a bill and its frozen lines; it never dispenses twice.
create function public.set_pharmacy_sale_amount(p_sale_id uuid, p_final_amount_paise bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
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
revoke execute on function public.set_pharmacy_sale_amount(uuid, bigint) from public, anon, authenticated;
grant execute on function public.set_pharmacy_sale_amount(uuid, bigint) to authenticated;
