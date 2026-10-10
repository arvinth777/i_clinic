begin;
create schema auth;
create role anon;
create role authenticated;
create role service_role bypassrls;
create table auth.users(id uuid primary key);
create table public.clinics(id uuid primary key);
create table public.user_roles(user_id uuid, clinic_id uuid, role text);
create table public.patients(id uuid primary key, clinic_id uuid, created_at timestamptz default now());
create table public.visits(id uuid primary key, patient_id uuid references public.patients(id), arrived_at timestamptz, stage text);
create table public.patient_comments(id uuid primary key, patient_id uuid references public.patients(id));
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
create function public.has_clinic_role(p_clinic uuid, p_role text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.user_roles where user_id=auth.uid() and clinic_id=p_clinic and role=p_role)$$;
grant usage on schema auth, public to authenticated, service_role;
grant select on public.patients to authenticated;
grant all on all tables in schema public to service_role;
alter table public.patients enable row level security;
create policy patient_read on public.patients for select to authenticated using(public.has_clinic_role(clinic_id,'doctor') or public.has_clinic_role(clinic_id,'receptionist'));
insert into auth.users values('30000000-0000-4000-8000-000000000001'),('30000000-0000-4000-8000-000000000002'),('30000000-0000-4000-8000-000000000003'),('30000000-0000-4000-8000-000000000004');
insert into public.clinics values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into public.user_roles values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','doctor'),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','receptionist'),
('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','admin'),
('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','doctor');
insert into public.patients values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','2026-01-01'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','2026-01-01'),
('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','2026-02-01');
