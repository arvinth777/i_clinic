-- "Not a duplicate": the doctor can dismiss a suggested pair so it stops being listed.
-- The pair is stored once (patient_a < patient_b, same order the suggestion uses). A merge deletes the
-- removed patient, so its dismissals go with it (on delete cascade). No update/delete policy: a dismissal is final.
create table public.duplicate_dismissals (
  clinic_id uuid not null references public.clinics(id),
  patient_a uuid not null references public.patients(id) on delete cascade,
  patient_b uuid not null references public.patients(id) on delete cascade,
  dismissed_by uuid not null default auth.uid() references auth.users(id),
  dismissed_at timestamptz not null default now(),
  primary key (patient_a, patient_b),
  check (patient_a < patient_b)
);
alter table public.duplicate_dismissals enable row level security;
revoke all on public.duplicate_dismissals from public, anon, authenticated;
grant select, insert on public.duplicate_dismissals to authenticated;
grant all on public.duplicate_dismissals to service_role;
create policy duplicate_dismissals_doctor_read on public.duplicate_dismissals for select to authenticated
  using (public.has_clinic_role(clinic_id, 'doctor'));
create policy duplicate_dismissals_doctor_insert on public.duplicate_dismissals for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, 'doctor')
    and (select count(*) from public.patients p where p.clinic_id = duplicate_dismissals.clinic_id and p.id in (patient_a, patient_b)) = 2
  );

-- Same function as 20261017020000, now skipping dismissed pairs.
create or replace function public.possible_duplicate_patients(p_clinic_id uuid)
returns table(a jsonb, b jsonb, reason text)
language sql stable set search_path to '' as $$
  with p as (
    select id, name, age, phone,
           lower(regexp_replace(trim(name), '\s+', ' ', 'g')) as nm,
           (select max(v.arrived_at) from public.visits v where v.patient_id = pt.id) as last_visit_at
    from public.patients pt where clinic_id = p_clinic_id
  ), pairs as (
    -- one anchor per name+age group, so k identical records give k-1 pairs, not k(k-1)/2
    select a.id as x, b.id as y, 'Same name and age'::text as why, 1 as rank
    from (select *, row_number() over (partition by nm, age order by id) as rn from p) a
    join (select *, row_number() over (partition by nm, age order by id) as rn from p) b
      on a.nm = b.nm and a.age = b.age and a.rn = 1 and b.rn > 1
    union all
    select a.id, b.id, 'Same phone, similar name', 2
    from p a join p b on a.id < b.id and a.phone = b.phone
    where extensions.similarity(a.nm, b.nm) >= 0.5 -- 'ramesh k' vs 'ramesh kumar' passes; unrelated names do not
  ), best as (
    select distinct on (x, y) least(x, y) as x, greatest(x, y) as y, why from pairs order by x, y, rank
  )
  select to_jsonb(pa) - 'nm', to_jsonb(pb) - 'nm', best.why
  from best join p pa on pa.id = best.x join p pb on pb.id = best.y
  where not exists (select 1 from public.duplicate_dismissals d where d.patient_a = best.x and d.patient_b = best.y)
  order by greatest(pa.last_visit_at, pb.last_visit_at) desc nulls last, pa.id, pb.id
  limit 100;
$$;
