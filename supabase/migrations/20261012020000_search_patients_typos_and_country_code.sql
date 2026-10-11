-- search_patients follow-up: tolerate a spelling slip anywhere in a longer name (word-level
-- trigram) and a +91 / 0 country or trunk prefix before the stored 10-digit phone.

create or replace function public.search_patients(p_clinic_id uuid, p_query text)
returns table(id uuid, name text, age integer, gender text, phone text, address text, last_visit_at timestamp with time zone)
language sql stable set search_path to '' as $$
  with q as (
    select trim(p_query) as t,
           replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') as esc,
           regexp_replace(p_query, '\D', '', 'g') as digits,
           ((now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata') as today_start
  )
  select p.id, p.name, p.age, p.gender, p.phone, p.address,
    (select max(v.arrived_at) from public.visits v where v.patient_id = p.id) as last_visit_at
  from public.patients p, q
  where p.clinic_id = p_clinic_id and q.t <> '' and (
       p.name ilike (case when length(q.t) >= 2 then '%' else '' end) || q.esc || '%'
    or (length(q.digits) >= 3 and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || q.digits || '%')
    or (length(q.t) >= 3 and (p.name operator(extensions.%) q.t or q.t operator(extensions.<%) p.name))
    or (length(q.digits) >= 10 and q.digits like '%' || regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') and p.phone is not null)
    or (q.t ~ '^\d{1,6}$' and exists (
         select 1 from public.visits v
         where v.patient_id = p.id and v.arrived_at >= q.today_start and v.token_number = q.t::int))
  )
  order by
    (q.t ~ '^\d{1,6}$' and exists (select 1 from public.visits v where v.patient_id = p.id and v.arrived_at >= q.today_start and v.token_number = q.t::int)) desc,
    (p.name ilike q.esc || '%') desc,
    (select max(v.arrived_at) from public.visits v where v.patient_id = p.id) desc nulls last,
    extensions.similarity(p.name, q.t) desc
  limit 20;
$$;
