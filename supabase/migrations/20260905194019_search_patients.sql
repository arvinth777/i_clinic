-- Patient search for the Reception check-in screen. One input, matching
-- name (trigram similarity, via patients_name_trgm_idx) and phone (exact
-- prefix only, never fuzzy) together, per AGENTS.md Technical Decision #1.
--
-- SECURITY INVOKER (the default -- no SECURITY DEFINER here), so this runs
-- as the calling user and patients_select's existing RLS policy applies
-- exactly as if the client had queried patients directly. No role check is
-- duplicated in this function; RLS is the single source of truth for who
-- can see which rows.
--
-- Ranking is recency-first, not similarity-first: AGENTS.md's own words are
-- "recency beats typo-tolerance for real hit rate" -- a patient seen two
-- days ago should outrank an exact-name match from years back. Similarity
-- only breaks ties among patients with the same (or no) recent visit.
create or replace function public.search_patients(p_clinic_id uuid, p_query text)
returns table (
  id uuid,
  name text,
  age int,
  gender text,
  phone text,
  address text,
  last_visit_at timestamptz
)
language sql
stable
set search_path = ''
as $$
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

revoke execute on function public.search_patients(uuid, text) from public;
grant execute on function public.search_patients(uuid, text) to authenticated;
