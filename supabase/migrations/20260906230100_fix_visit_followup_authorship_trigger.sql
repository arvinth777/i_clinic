-- Fix for 20260906230000: enforce_visit_followup_authorship blocked the
-- doctor's own set_visit_follow_up RPC. That RPC deliberately clears
-- follow_up_done_at in the same statement as setting a new
-- follow_up_date (a revised date starts a fresh to-do), but the trigger
-- required receptionist role for ANY change to follow_up_done_at --
-- including this one, made by a doctor. Caught by phase-d-test.mjs
-- (red): "setting a new follow-up date clears any earlier done mark".
--
-- Fix: follow_up_done_at may change under either role. follow_up_date
-- stays doctor-only, unchanged. This still blocks the case the trigger
-- exists for -- an account holding neither role touching either column
-- -- while allowing both of the two legitimate paths (reception marking
-- done; doctor clearing it as a side effect of setting a new date).

create or replace function public.enforce_visit_followup_authorship()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.follow_up_date is distinct from old.follow_up_date
     and not public.has_clinic_role(new.clinic_id, 'doctor') then
    raise exception 'only a doctor can set a visit follow-up date';
  end if;

  if new.follow_up_done_at is distinct from old.follow_up_done_at
     and not (public.has_clinic_role(new.clinic_id, 'doctor') or public.has_clinic_role(new.clinic_id, 'receptionist')) then
    raise exception 'only doctor or reception can change a follow-up''s done status';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_visit_followup_authorship() from public, anon, authenticated;
