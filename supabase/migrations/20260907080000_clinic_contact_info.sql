-- clinics: address / phone -- the last two fields the printed prescription
-- letterhead needs (name and doctor_name/doctor_registration_number
-- already exist, 20260906230000). Same idiom as doctor_info and upi_vpa:
-- clinics has no client update policy at all, so a narrow admin-gated RPC,
-- not a blanket UPDATE that would also expose next_token_number.

alter table public.clinics
  add column address text,
  add column phone text;

create or replace function public.admin_set_clinic_contact_info(p_clinic_id uuid, p_address text, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_clinic_role(p_clinic_id, 'admin') then
    raise exception 'only admin can configure the clinic contact info';
  end if;

  update public.clinics
  set address = nullif(trim(p_address), ''),
      phone = nullif(trim(p_phone), '')
  where id = p_clinic_id;
end;
$$;

revoke execute on function public.admin_set_clinic_contact_info(uuid, text, text) from public;
revoke execute on function public.admin_set_clinic_contact_info(uuid, text, text) from anon;
grant execute on function public.admin_set_clinic_contact_info(uuid, text, text) to authenticated;
