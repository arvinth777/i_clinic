-- Keep the issue date with the clinical PDF snapshot, including overnight visits.
create or replace function public.archive_visit_snapshot(p_visit_id uuid,p_clinical boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',v.id,'token_number',v.token_number,'stage',v.stage,'arrived_at',v.arrived_at,'consultation_ended_at',v.consultation_ended_at,'patients',jsonb_build_object('name',p.name,'age',p.age,'gender',p.gender,'height_cm',p.height_cm,'weight_kg',p.weight_kg))
 || case when p_clinical then jsonb_build_object('complaint',v.complaint,'diagnosis',(select string_agg(distinct pr.diagnosis,E'\n') from public.prescriptions pr where pr.visit_id=v.id),'advice',(select string_agg(distinct pr.advice,E'\n') from public.prescriptions pr where pr.visit_id=v.id),'follow_up_date',v.follow_up_date) else '{}'::jsonb end
 from public.visits v join public.patients p on p.id=v.patient_id where v.id=p_visit_id;
$$;
revoke execute on function public.archive_visit_snapshot(uuid,boolean) from public,anon,authenticated;
grant execute on function public.archive_visit_snapshot(uuid,boolean) to service_role;
