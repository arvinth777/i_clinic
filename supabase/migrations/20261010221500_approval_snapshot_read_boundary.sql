-- Clinical snapshots use the scoped handoff RPC; reception must not query older
-- clinical approvals directly, including those from earlier patient visits.
drop policy pricing_approvals_select on public.pricing_approvals;
create policy pricing_approvals_select on public.pricing_approvals for select
 using(public.has_clinic_role(clinic_id,'doctor'));
