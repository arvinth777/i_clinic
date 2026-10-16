-- Likely duplicate patient pairs for the doctor to review (the merge itself stays manual: merge_patients).
-- A pair is listed when: same name and same age; or the same phone AND a similar name. The same phone
-- alone is not enough: families share one number. (patients.phone is always exactly 10 digits.)
-- Each side is returned as {id, name, age, phone, last_visit_at}, the shape the merge screen already uses.
-- SECURITY INVOKER: runs under the caller's own patients RLS, like search_patients.
-- (dropped first: this file was reworked on staging before it ever reached production)
drop function if exists public.possible_duplicate_patients(uuid);
create function public.possible_duplicate_patients(p_clinic_id uuid)
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
    select distinct on (x, y) x, y, why from pairs order by x, y, rank
  )
  select to_jsonb(pa) - 'nm', to_jsonb(pb) - 'nm', best.why
  from best join p pa on pa.id = best.x join p pb on pb.id = best.y
  order by greatest(pa.last_visit_at, pb.last_visit_at) desc nulls last, pa.id, pb.id
  limit 100;
$$;
revoke all on function public.possible_duplicate_patients(uuid) from public, anon;
grant execute on function public.possible_duplicate_patients(uuid) to authenticated;
