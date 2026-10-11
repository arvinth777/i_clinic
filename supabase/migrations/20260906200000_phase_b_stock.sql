-- Phase B (docs/build-plan.md): stock.
--
-- Ledger-plus-derived-state, mirroring the app's existing money
-- architecture (bills/bill_line_items as the immutable ledger,
-- visit_pricing as the maintained current state): stock_movements is the
-- append-only source of truth, medicine_stock is a maintained running
-- total kept in sync by a trigger. medicine_stock has no client-writable
-- policy at all -- every quantity change, including the initial one, goes
-- through a stock_movements row so the ledger can never drift from the
-- total and there is always an audit trail for "why is this number what
-- it is".
--
-- All new tables are doctor/receptionist only, same footing as
-- visits/visit_pricing -- stock is a day-to-day clinical-operations
-- concern, not admin catalog/config (Phase A's admin role).

create table public.stock_points (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (clinic_id, name)
);

alter table public.stock_points enable row level security;

create policy stock_points_select on public.stock_points
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

-- No insert/update/delete policy: the two stock points a clinic has
-- (Counter, Storeroom) are seeded below, not created by a client role.
-- Adding a third stock point in the future is a migration action, same
-- posture as clinics itself.

insert into public.stock_points (clinic_id, name)
select c.id, sp.name
from public.clinics c
cross join (values ('Counter'), ('Storeroom')) as sp(name);

-- ============================================================
-- medicine_stock
--
-- The maintained current total, one row per (medicine, stock point).
-- SELECT-only for doctor/receptionist -- never directly writable by any
-- client role. Every change flows through stock_movements and the
-- trigger below, so the running total can never disagree with the
-- ledger it's derived from.
-- ============================================================

create table public.medicine_stock (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  medicine_id uuid not null references public.medicines(id),
  stock_point_id uuid not null references public.stock_points(id),
  quantity int not null default 0,
  updated_at timestamptz not null default now(),
  unique (medicine_id, stock_point_id)
);

create index medicine_stock_clinic_id_idx on public.medicine_stock (clinic_id);

alter table public.medicine_stock enable row level security;

create policy medicine_stock_select on public.medicine_stock
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

-- ============================================================
-- stock_movements
--
-- The append-only ledger. doctor/receptionist can INSERT and SELECT
-- directly -- no UPDATE/DELETE policy exists for anyone, matching
-- bills/bill_line_items' own immutability. The sign-per-reason check
-- keeps a movement's direction honest at the database level, not just
-- in application code: a "dispensed" row can never accidentally add
-- stock, a "purchase" row can never accidentally remove it.
--
-- reference_id is a free-form correlation id (a purchase id, a bill id,
-- or a generated id shared by a transfer's two paired rows) -- not a
-- foreign key, since it points at different tables depending on reason.
-- ============================================================

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  medicine_id uuid not null references public.medicines(id),
  stock_point_id uuid not null references public.stock_points(id),
  quantity_delta int not null check (quantity_delta <> 0),
  reason text not null check (reason in ('purchase', 'transfer_in', 'transfer_out', 'dispensed', 'adjustment', 'count_correction')),
  reference_id uuid,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint stock_movements_sign_matches_reason check (
    (reason in ('purchase', 'transfer_in') and quantity_delta > 0)
    or (reason in ('transfer_out', 'dispensed') and quantity_delta < 0)
    or (reason in ('adjustment', 'count_correction'))
  ),
  constraint stock_movements_adjustment_requires_notes check (
    reason <> 'adjustment' or (notes is not null and trim(notes) <> '')
  )
);

create index stock_movements_clinic_id_idx on public.stock_movements (clinic_id);
create index stock_movements_medicine_stock_point_idx on public.stock_movements (medicine_id, stock_point_id);

alter table public.stock_movements enable row level security;

create policy stock_movements_select on public.stock_movements
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create policy stock_movements_insert on public.stock_movements
  for insert
  with check (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

-- ============================================================
-- apply_stock_movement
--
-- Maintains medicine_stock from stock_movements, the same
-- "lower-privileged inserting role indirectly affecting a table they
-- can't touch directly" idiom as assign_token_number/create_visit_pricing.
-- Deliberately allows the running total to go negative (no floor here) --
-- an item dispensed when the real shelf is already empty is a real event
-- reception needs to see, not a state the database should hide by
-- clamping at zero.
-- ============================================================

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.medicine_stock (clinic_id, medicine_id, stock_point_id, quantity)
  values (new.clinic_id, new.medicine_id, new.stock_point_id, new.quantity_delta)
  on conflict (medicine_id, stock_point_id)
  do update set quantity = public.medicine_stock.quantity + excluded.quantity, updated_at = now();
  return new;
end;
$$;

create trigger trg_apply_stock_movement
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

revoke execute on function public.apply_stock_movement() from anon, authenticated;

-- ============================================================
-- suppliers
-- ============================================================

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  name text not null,
  phone text,
  address text,
  created_at timestamptz not null default now()
);

create index suppliers_clinic_id_idx on public.suppliers (clinic_id);

alter table public.suppliers enable row level security;

create policy suppliers_select on public.suppliers
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create policy suppliers_insert on public.suppliers
  for insert
  with check (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create policy suppliers_update on public.suppliers
  for update
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

-- ============================================================
-- purchases / purchase_items
--
-- Immutable once recorded, same posture as bills/bill_line_items --
-- SELECT/INSERT only, no update/delete policy.
-- ============================================================

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  supplier_id uuid not null references public.suppliers(id),
  invoice_number text not null,
  purchase_date date not null,
  stock_point_id uuid not null references public.stock_points(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index purchases_clinic_id_idx on public.purchases (clinic_id);
create index purchases_supplier_id_idx on public.purchases (supplier_id);

alter table public.purchases enable row level security;

create policy purchases_select on public.purchases
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create policy purchases_insert on public.purchases
  for insert
  with check (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  purchase_id uuid not null references public.purchases(id),
  medicine_id uuid not null references public.medicines(id),
  quantity int not null check (quantity > 0),
  cost_price_paise bigint not null check (cost_price_paise >= 0)
);

create index purchase_items_purchase_id_idx on public.purchase_items (purchase_id);

alter table public.purchase_items enable row level security;

create policy purchase_items_select on public.purchase_items
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create policy purchase_items_insert on public.purchase_items
  for insert
  with check (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

-- ============================================================
-- stock_counts / stock_count_lines
--
-- gap_quantity is generated, never entered -- same discipline as
-- visit_pricing.discount_paise: derived, not a value a client can set
-- directly (and so can never disagree with expected/counted).
-- ============================================================

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  stock_point_id uuid not null references public.stock_points(id),
  counted_by uuid not null references auth.users(id),
  counted_at timestamptz not null default now()
);

create index stock_counts_clinic_id_idx on public.stock_counts (clinic_id);

alter table public.stock_counts enable row level security;

create policy stock_counts_select on public.stock_counts
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create policy stock_counts_insert on public.stock_counts
  for insert
  with check (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create table public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  stock_count_id uuid not null references public.stock_counts(id),
  medicine_id uuid not null references public.medicines(id),
  expected_quantity int not null,
  counted_quantity int not null check (counted_quantity >= 0),
  gap_quantity int generated always as (counted_quantity - expected_quantity) stored
);

create index stock_count_lines_stock_count_id_idx on public.stock_count_lines (stock_count_id);

alter table public.stock_count_lines enable row level security;

create policy stock_count_lines_select on public.stock_count_lines
  for select
  using (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

create policy stock_count_lines_insert on public.stock_count_lines
  for insert
  with check (
    public.has_clinic_role(clinic_id, 'doctor')
    or public.has_clinic_role(clinic_id, 'receptionist')
  );

-- ============================================================
-- prescription_items.quantity_dispensed
--
-- Nullable and new -- prescription_items never had a quantity concept
-- (billing deliberately charges one flat unit per medicine regardless of
-- amount dispensed, see recompute_visit_pricing's own header; that stays
-- unchanged here, this column is stock-only). Required going forward in
-- the doctor-facing prescription form; historical NULL rows fall back to
-- coalesce(quantity_dispensed, 1) wherever stock is deducted.
-- ============================================================

alter table public.prescription_items
  add column quantity_dispensed int check (quantity_dispensed > 0);

-- ============================================================
-- record_purchase
--
-- security invoker (not definer): every table it touches already grants
-- doctor/receptionist direct INSERT via RLS above, so this exists only
-- for atomicity (one purchase with N items, one round trip) -- not to
-- elevate privilege. RLS enforces authorization on each underlying
-- insert exactly as if the caller ran them one at a time.
-- ============================================================

create or replace function public.record_purchase(
  p_clinic_id uuid,
  p_supplier_id uuid,
  p_invoice_number text,
  p_purchase_date date,
  p_stock_point_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
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

revoke execute on function public.record_purchase(uuid, uuid, text, date, uuid, jsonb) from public;
grant execute on function public.record_purchase(uuid, uuid, text, date, uuid, jsonb) to authenticated;

-- ============================================================
-- create_stock_transfer
--
-- Two paired stock_movements rows sharing one reference_id -- no
-- separate stock_transfers table, the ledger already carries the full
-- story. security invoker for the same reason as record_purchase.
-- ============================================================

create or replace function public.create_stock_transfer(
  p_clinic_id uuid,
  p_medicine_id uuid,
  p_from_stock_point_id uuid,
  p_to_stock_point_id uuid,
  p_quantity int,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
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

revoke execute on function public.create_stock_transfer(uuid, uuid, uuid, uuid, int, text) from public;
grant execute on function public.create_stock_transfer(uuid, uuid, uuid, uuid, int, text) to authenticated;

-- ============================================================
-- record_stock_count
--
-- Reads medicine_stock live, server-side, as expected_quantity -- never
-- trusts a client-supplied expected value (the same discipline as
-- calculated_total_paise being recomputed server-side, never trusted
-- from the client). One atomic call for the whole count sheet.
-- ============================================================

create or replace function public.record_stock_count(
  p_clinic_id uuid,
  p_stock_point_id uuid,
  p_lines jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
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

revoke execute on function public.record_stock_count(uuid, uuid, jsonb) from public;
grant execute on function public.record_stock_count(uuid, uuid, jsonb) to authenticated;

-- ============================================================
-- adjust_stock
--
-- One movement, a required human-readable reason (also enforced at the
-- table level by stock_movements_adjustment_requires_notes above -- this
-- check is defense in depth, not the only gate).
-- ============================================================

create or replace function public.adjust_stock(
  p_clinic_id uuid,
  p_medicine_id uuid,
  p_stock_point_id uuid,
  p_quantity_delta int,
  p_reason text
)
returns uuid
language plpgsql
set search_path = ''
as $$
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

revoke execute on function public.adjust_stock(uuid, uuid, uuid, int, text) from public;
grant execute on function public.adjust_stock(uuid, uuid, uuid, int, text) to authenticated;

-- ============================================================
-- confirm_bill: add non-blocking stock deduction
--
-- CREATE OR REPLACE of the whole function (migrations are immutable --
-- this is a new migration, never an edit of 20260906130000's file).
-- Only change from the original: after the medicine bill_line_items are
-- built, deduct each still-present prescribed medicine from the 'Counter'
-- stock point. Guarded on the stock point existing at all -- "never
-- block a live patient on a technical failure" -- if a clinic somehow has
-- no Counter stock point, billing still completes, it just doesn't move
-- stock. Deliberately reads prescription_items as they stand at confirm
-- time, so a medicine already removed for "dispensed externally" is
-- automatically excluded, no separate flag needed.
-- ============================================================

create or replace function public.confirm_bill(p_visit_id uuid, p_payment_method text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_stage text;
  v_existing_bill_id uuid;
  v_bill_id uuid;
  v_final_amount bigint;
  v_revision bigint;
  v_final_amount_set boolean;
  v_fee bigint;
  v_counter_id uuid;
begin
  select clinic_id, stage into v_clinic_id, v_stage
  from public.visits
  where id = p_visit_id
  for update;

  if v_clinic_id is null then
    raise exception 'unknown visit %', p_visit_id;
  end if;

  if not public.has_clinic_role(v_clinic_id, 'receptionist') then
    raise exception 'only reception can confirm a bill';
  end if;

  if v_stage = 'paid' then
    select id into v_existing_bill_id
    from public.bills
    where visit_id = p_visit_id and corrects_bill_id is null
    order by confirmed_at desc
    limit 1;
    return v_existing_bill_id;
  end if;

  if v_stage <> 'ready_at_reception' then
    raise exception 'visit % is not ready for billing (stage=%)', p_visit_id, v_stage;
  end if;

  select final_amount_paise, revision_number, final_amount_set
  into v_final_amount, v_revision, v_final_amount_set
  from public.visit_pricing
  where visit_id = p_visit_id;

  if not v_final_amount_set then
    raise exception 'doctor has not set the final amount yet for visit %', p_visit_id;
  end if;

  insert into public.bills (clinic_id, visit_id, final_amount_paise, pricing_revision_at_confirm, payment_method, confirmed_by)
  values (v_clinic_id, p_visit_id, v_final_amount, v_revision, p_payment_method, auth.uid())
  returning id into v_bill_id;

  select consultation_fee_paise into v_fee from public.clinics where id = v_clinic_id;

  insert into public.bill_line_items (clinic_id, bill_id, kind, description, unit_price_paise)
  values (v_clinic_id, v_bill_id, 'consultation', 'Consultation', v_fee);

  insert into public.bill_line_items (clinic_id, bill_id, kind, procedure_id, description, unit_price_paise)
  select v_clinic_id, v_bill_id, 'procedure', vp.procedure_id, p.name, vp.price_paise
  from public.visit_procedures vp
  join public.procedures p on p.id = vp.procedure_id
  where vp.visit_id = p_visit_id;

  insert into public.bill_line_items (clinic_id, bill_id, kind, medicine_id, description, unit_price_paise)
  select v_clinic_id, v_bill_id, 'medicine', pi.medicine_id, m.name, m.price_paise
  from public.prescription_items pi
  join public.prescriptions pr on pr.id = pi.prescription_id
  join public.medicines m on m.id = pi.medicine_id
  where pr.visit_id = p_visit_id;

  select id into v_counter_id from public.stock_points where clinic_id = v_clinic_id and name = 'Counter';

  if v_counter_id is not null then
    insert into public.stock_movements (clinic_id, medicine_id, stock_point_id, quantity_delta, reason, reference_id, created_by)
    select v_clinic_id, pi.medicine_id, v_counter_id, -coalesce(pi.quantity_dispensed, 1), 'dispensed', v_bill_id, auth.uid()
    from public.prescription_items pi
    join public.prescriptions pr on pr.id = pi.prescription_id
    where pr.visit_id = p_visit_id;
  end if;

  update public.visits
  set stage = 'paid', closed_at = now()
  where id = p_visit_id;

  return v_bill_id;
end;
$$;

revoke execute on function public.confirm_bill(uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_bill(uuid, text) to authenticated;

-- ============================================================
-- Deferred seed case (AGENTS.md convention: rides with the table that
-- makes it possible): an item dispensed into negative stock. A medicine
-- with zero purchases, ever, deducted by a paid visit's prescription --
-- the exact "shelf says less than zero" state reception needs to be able
-- to see and act on, not one the schema hides.
-- ============================================================

do $$
declare
  v_clinic_id uuid;
  v_counter_id uuid;
  v_medicine_id uuid;
  v_patient_id uuid;
  v_visit_id uuid;
  v_prescription_id uuid;
begin
  select id into v_clinic_id from public.clinics limit 1;
  select id into v_counter_id from public.stock_points where clinic_id = v_clinic_id and name = 'Counter';

  insert into public.medicines (clinic_id, name, price_paise)
  values (v_clinic_id, 'Seed Negative Stock Medicine', 4000)
  returning id into v_medicine_id;

  insert into public.patients (clinic_id, name, age)
  values (v_clinic_id, 'Seed Negative Stock Patient', 50)
  returning id into v_patient_id;

  insert into public.visits (clinic_id, patient_id, arrived_at, complaint, stage, closed_at)
  values (v_clinic_id, v_patient_id, now() - interval '1 day', 'seed: negative stock case', 'paid', now() - interval '1 day')
  returning id into v_visit_id;

  insert into public.prescriptions (clinic_id, visit_id)
  values (v_clinic_id, v_visit_id)
  returning id into v_prescription_id;

  insert into public.prescription_items (clinic_id, prescription_id, medicine_id, duration_days, quantity_dispensed)
  values (v_clinic_id, v_prescription_id, v_medicine_id, 5, 10);

  -- no purchase was ever recorded for this medicine -- the movement below
  -- takes it straight to -10, exactly what a real "sold out but the
  -- doctor still prescribed it" day looks like.
  insert into public.stock_movements (clinic_id, medicine_id, stock_point_id, quantity_delta, reason, reference_id, created_by)
  select v_clinic_id, v_medicine_id, v_counter_id, -10, 'dispensed', v_visit_id, u.id
  from auth.users u
  join public.user_roles ur on ur.user_id = u.id
  where ur.clinic_id = v_clinic_id and ur.role = 'receptionist'
  limit 1;
end $$;
