-- Keep retired catalog rows for history, but reject new clinical and sale references.
create or replace function public.retire_medicine(p_medicine_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from public.medicines where id = p_medicine_id for update;
  if v_clinic_id is null or not (
    public.has_clinic_role(v_clinic_id, 'doctor')
    or public.has_clinic_role(v_clinic_id, 'receptionist')
    or public.has_clinic_role(v_clinic_id, 'admin')
  ) then raise exception 'clinic staff required'; end if;
  update public.medicines set is_active = false, updated_at = now() where id = p_medicine_id;
end;
$$;
revoke execute on function public.retire_medicine(uuid) from public, anon, authenticated;
grant execute on function public.retire_medicine(uuid) to authenticated;

create function public.reject_retired_medicine()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.medicine_id = old.medicine_id then return new; end if;
  if not exists (
    select 1 from public.medicines m
    where m.id = new.medicine_id and m.clinic_id = new.clinic_id and m.is_active
  ) then raise exception 'medicine is retired or belongs to another clinic'; end if;
  return new;
end;
$$;
revoke execute on function public.reject_retired_medicine() from public, anon, authenticated;

create trigger prescription_item_active_medicine before insert or update of medicine_id
on public.prescription_items for each row execute function public.reject_retired_medicine();
create trigger pharmacy_sale_item_active_medicine before insert or update of medicine_id
on public.pharmacy_sale_items for each row execute function public.reject_retired_medicine();
