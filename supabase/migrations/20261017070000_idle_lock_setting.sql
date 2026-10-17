-- Clinic-wide switch for the idle screen lock (the 2 minute reception / 15 minute doctor timeout).
-- On by default. Settings use a narrow RPC because clinics has no client UPDATE policy.
alter table public.clinics add column idle_lock_enabled boolean not null default true;

create function public.set_idle_lock(p_clinic_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.has_clinic_role(p_clinic_id, 'doctor') or public.has_clinic_role(p_clinic_id, 'admin')) then
    raise exception 'doctor or administrator required';
  end if;
  if p_enabled is null then raise exception 'choose on or off'; end if;
  update public.clinics set idle_lock_enabled = p_enabled where id = p_clinic_id;
end;
$$;
revoke execute on function public.set_idle_lock(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_idle_lock(uuid,boolean) to authenticated;
