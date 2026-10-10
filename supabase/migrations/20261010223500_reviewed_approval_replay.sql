-- A queued prescription/procedure write changes the revision before approval
-- replays. Match every reviewed financial line, not an obsolete revision alone.
create function public.approval_financial_lines(p_lines jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(line order by line::text),'[]'::jsonb) from (
  select jsonb_build_object('kind',l->'kind','prescription_item_id',l->'prescription_item_id',
   'procedure_id',l->'procedure_id','medicine_id',l->'medicine_id','quantity',l->'quantity',
   'stock_unit',l->'stock_unit','unit_price_paise',l->'unit_price_paise') line
  from jsonb_array_elements(p_lines) l
 ) rows
$$;
revoke execute on function public.approval_financial_lines(jsonb) from public,anon,authenticated;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.approve_visit_pricing(uuid,bigint,bigint,bigint,uuid)'::regprocedure);
 definition:=replace(definition,'p_request_id uuid)', 'p_request_id uuid, p_expected_lines jsonb DEFAULT NULL::jsonb)');
 definition:=replace(definition,'''revision'',p_expected_revision_number)', '''revision'',p_expected_revision_number,''lines'',p_expected_lines)');
 definition:=replace(definition,'or p_expected_revision_number is distinct from (proposal->>''revision_number'')::bigint', 'or (p_expected_lines is null and p_expected_revision_number is distinct from (proposal->>''revision_number'')::bigint) or (p_expected_lines is not null and public.approval_financial_lines(p_expected_lines) is distinct from public.approval_financial_lines(proposal->''lines''))');
 drop function public.approve_visit_pricing(uuid,bigint,bigint,bigint,uuid);
 execute definition;
end $$;
revoke execute on function public.approve_visit_pricing(uuid,bigint,bigint,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.approve_visit_pricing(uuid,bigint,bigint,bigint,uuid,jsonb) to authenticated;
