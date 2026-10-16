alter table public.clinics
  add column called_reminder_minutes integer not null default 5 check (called_reminder_minutes between 1 and 240),
  add column closing_minute integer not null default 960 check (closing_minute between 0 and 1439);

-- The existing clinic has no client UPDATE policy: settings use a narrow RPC.
create function public.set_alert_settings(p_clinic_id uuid, p_called_reminder_minutes integer, p_closing_minute integer, p_no_show_minutes integer default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.has_clinic_role(p_clinic_id, 'doctor') or public.has_clinic_role(p_clinic_id, 'admin')) then
    raise exception 'doctor or administrator required';
  end if;
  if p_called_reminder_minutes is null or p_called_reminder_minutes not between 1 and 240
     or p_closing_minute is null or p_closing_minute not between 0 and 1439
     or (p_no_show_minutes is not null and p_no_show_minutes not between 1 and 240) then
    raise exception 'use 1 to 240 reminder minutes and a valid clinic closing time';
  end if;
  update public.clinics set called_reminder_minutes = p_called_reminder_minutes,
    closing_minute = p_closing_minute, no_show_minutes = coalesce(p_no_show_minutes, no_show_minutes)
  where id = p_clinic_id;
end;
$$;
revoke execute on function public.set_alert_settings(uuid,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.set_alert_settings(uuid,integer,integer,integer) to authenticated;
