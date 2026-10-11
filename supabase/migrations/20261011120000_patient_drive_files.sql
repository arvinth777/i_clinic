-- Private Drive credentials and one-use, user-bound OAuth attempts are server-only.
create table public.clinic_drive_connections (
  clinic_id uuid primary key references public.clinics(id),
  account_id text not null,
  account_email text not null,
  folder_id text not null,
  refresh_token_ciphertext text,
  connected_by uuid not null references auth.users(id),
  connected_at timestamptz not null default now()
);
create table public.clinic_drive_oauth_states (
  state_hash text primary key,
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.clinic_drive_connections enable row level security;
alter table public.clinic_drive_oauth_states enable row level security;
revoke all on public.clinic_drive_connections, public.clinic_drive_oauth_states from public, anon, authenticated;
grant all on public.clinic_drive_connections, public.clinic_drive_oauth_states to service_role;

create table public.patient_files (
  id uuid primary key,
  clinic_id uuid not null references public.clinics(id),
  patient_id uuid not null references public.patients(id),
  title text not null check (length(btrim(title)) between 1 and 160),
  category text not null check (category in ('MRI', 'X-ray', 'Lab report', 'Discharge summary', 'Other')),
  examination_date date,
  note text not null default '' check (length(note) <= 2000),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes between 1 and 26214400),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  drive_file_id text not null unique,
  status text not null default 'uploading' check (status in ('uploading', 'ready')),
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index patient_files_patient_idx on public.patient_files(clinic_id, patient_id, created_at desc, id);
alter table public.patient_files enable row level security;
revoke all on public.patient_files from public, anon, authenticated;
grant select on public.patient_files to authenticated;
grant all on public.patient_files to service_role;
create policy patient_files_doctor_read on public.patient_files for select to authenticated
  using (public.has_clinic_role(clinic_id, 'doctor') and exists (
    select 1 from public.patients p where p.id = patient_id and p.clinic_id = patient_files.clinic_id
  ));

-- A patient merge may reassign this link; a clinic mismatch is never valid.
create function public.check_patient_file_clinic() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.patients where id = new.patient_id and clinic_id = new.clinic_id) then
    raise exception 'invalid patient clinic';
  end if;
  return new;
end $$;
revoke all on function public.check_patient_file_clinic() from public, anon, authenticated;
create trigger patient_file_clinic before insert or update of patient_id, clinic_id on public.patient_files
  for each row execute function public.check_patient_file_clinic();

-- Serialize reconnects so concurrent consent flows cannot switch a clinic's Drive.
create function public.save_clinic_drive_connection(p_clinic_id uuid, p_user_id uuid, p_account_id text, p_email text, p_folder_id text, p_ciphertext text)
returns void language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clinic_id::text, 1400));
  if not exists (select 1 from public.user_roles where user_id = p_user_id and clinic_id = p_clinic_id and role = 'doctor') then
    raise exception 'doctor access required';
  end if;
  if exists (select 1 from public.clinic_drive_connections where clinic_id = p_clinic_id and account_id <> p_account_id) then
    raise exception 'reconnect the same clinic account';
  end if;
  insert into public.clinic_drive_connections(clinic_id, account_id, account_email, folder_id, refresh_token_ciphertext, connected_by)
  values (p_clinic_id, p_account_id, p_email, p_folder_id, p_ciphertext, p_user_id)
  on conflict (clinic_id) do update set refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    account_email = excluded.account_email, connected_by = excluded.connected_by, connected_at = now();
end $$;
revoke all on function public.save_clinic_drive_connection(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.save_clinic_drive_connection(uuid,uuid,text,text,text,text) to service_role;

-- Preserve attached files when the doctor merges duplicate patient profiles.
create or replace function public.merge_patients(p_patient_a uuid, p_patient_b uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_clinic_b uuid;
  v_created_a timestamptz;
  v_created_b timestamptz;
  v_keep_id uuid;
  v_remove_id uuid;
  v_today timestamptz := date_trunc('day', now());
begin
  select clinic_id, created_at into v_clinic_id, v_created_a from public.patients where id = p_patient_a;
  select clinic_id, created_at into v_clinic_b, v_created_b from public.patients where id = p_patient_b;

  if v_clinic_id is null or v_clinic_b is null then
    raise exception 'unknown patient';
  end if;
  if v_clinic_id <> v_clinic_b then
    raise exception 'patients belong to different clinics';
  end if;
  if not public.has_clinic_role(v_clinic_id, 'doctor') then
    raise exception 'only a doctor can merge patients';
  end if;

  if v_created_a <= v_created_b then
    v_keep_id := p_patient_a;
    v_remove_id := p_patient_b;
  else
    v_keep_id := p_patient_b;
    v_remove_id := p_patient_a;
  end if;

  if exists (
    select 1 from public.visits
    where patient_id in (v_keep_id, v_remove_id)
      and arrived_at >= v_today
      and stage <> 'paid'
  ) then
    raise exception 'one of these patients has an open visit today -- resolve it before merging';
  end if;

  update public.visits set patient_id = v_keep_id where patient_id = v_remove_id;
  update public.patient_files set patient_id = v_keep_id where patient_id = v_remove_id;
  update public.patient_comments set patient_id = v_keep_id where patient_id = v_remove_id;

  delete from public.patients where id = v_remove_id;

  return v_keep_id;
end;
$$;


revoke all on function public.merge_patients(uuid,uuid) from public, anon, authenticated;
grant execute on function public.merge_patients(uuid,uuid) to authenticated;
