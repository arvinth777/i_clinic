-- Reception may add catalog medicines. Removal retires a medicine so prescriptions,
-- price audit, stock movements and paid bills retain their references.
alter table public.medicines add column is_active boolean not null default true;

drop policy medicines_insert on public.medicines;
create policy medicines_insert on public.medicines for insert
  with check (public.has_clinic_role(clinic_id, 'doctor') or public.has_clinic_role(clinic_id, 'admin') or public.has_clinic_role(clinic_id, 'receptionist'));

create function public.retire_medicine(p_medicine_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.medicines where id = p_medicine_id for update;
  if v_clinic_id is null or not (public.has_clinic_role(v_clinic_id, 'doctor') or public.has_clinic_role(v_clinic_id, 'receptionist')) then
    raise exception 'clinic staff required';
  end if;
  update public.medicines set is_active = false, updated_at = now() where id = p_medicine_id;
end;
$$;
revoke execute on function public.retire_medicine(uuid) from public, anon, authenticated;
grant execute on function public.retire_medicine(uuid) to authenticated;
