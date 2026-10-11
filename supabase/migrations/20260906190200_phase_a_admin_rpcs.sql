-- Two narrow, purpose-scoped SECURITY DEFINER reads for the Admin screen --
-- same idiom as search_patients/get_visit_billing_detail (an elevated read
-- scoped to one specific job, not a blanket RLS relaxation).
--
-- list_clinic_logins: user_roles' own RLS already lets admin read every
-- role row for their clinic, but auth.users lives outside the `public`
-- schema PostgREST exposes -- there is no other way for the client to
-- learn which email a user_id belongs to. Admin-gated internally, not
-- just left to the caller having gotten this far.
--
-- admin_search_patients_for_merge: patients_select requires doctor or
-- receptionist -- admin (per docs/architecture-spec.md's Phase E
-- constraint: aggregates only, no row-level clinical access) has no
-- direct read on patients at all, confirmed by the admin-phase-test.mjs
-- run this phase (querying visits as admin.only returned nothing). Merge
-- still needs *some* way to identify which two records are duplicates.
-- This returns only what's needed to tell two patients apart in a picker
-- (name, age, phone, when created) -- no complaint, no history, no
-- clinical detail -- and only admin can call it.

create or replace function public.list_clinic_logins(p_clinic_id uuid)
returns table (user_id uuid, email text, role text)
language plpgsql
security definer
set search_path = ''
as $$
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

revoke execute on function public.list_clinic_logins(uuid) from public;
revoke execute on function public.list_clinic_logins(uuid) from anon;
grant execute on function public.list_clinic_logins(uuid) to authenticated;

create or replace function public.admin_search_patients_for_merge(p_clinic_id uuid, p_query text)
returns table (id uuid, name text, age int, phone text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_clinic_role(p_clinic_id, 'admin') then
    return;
  end if;

  return query
  select p.id, p.name, p.age, p.phone, p.created_at
  from public.patients p
  where p.clinic_id = p_clinic_id
    and (p.name ilike '%' || p_query || '%' or p.phone like p_query || '%')
  order by p.name
  limit 20;
end;
$$;

revoke execute on function public.admin_search_patients_for_merge(uuid, text) from public;
revoke execute on function public.admin_search_patients_for_merge(uuid, text) from anon;
grant execute on function public.admin_search_patients_for_merge(uuid, text) to authenticated;
