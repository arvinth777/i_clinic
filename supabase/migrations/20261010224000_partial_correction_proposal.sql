-- Show exactly what the correction will write, including partial supply.
do $$ declare definition text; revised text; begin
 definition:=pg_get_viewdef('public.bills_needing_reconciliation'::regclass,true);
 revised:=regexp_replace(definition,'vp[.]final_amount_paise AS live_final_amount_paise',
  'case when not vp.final_amount_set or not exists(select 1 from public.bill_line_items li where li.bill_id=b.id) then null else greatest(0,(select sum(li.line_total_paise)::bigint from public.bill_line_items li where li.bill_id=b.id)-(vp.calculated_total_paise-vp.final_amount_paise)) end AS live_final_amount_paise','i');
 if revised=definition then raise exception 'correction view shape changed'; end if;
 execute 'create or replace view public.bills_needing_reconciliation with(security_invoker=true) as '||revised;
 definition:=pg_get_functiondef('public.correct_bill(uuid)'::regprocedure);
 definition:=replace(definition,'p_bill_id uuid)','p_bill_id uuid, p_expected_amount_paise bigint DEFAULT NULL::bigint)');
 definition:=replace(definition,'then raise exception ''bill already corrected''; end if;',E'then\n select id into result from public.bills where corrects_bill_id=b.id and (p_expected_amount_paise is null or final_amount_paise=p_expected_amount_paise);\n if result is null then raise exception ''bill already corrected to another amount''; end if;\n return result; end if;');
 definition:=replace(definition,'discount:=p.calculated_total_paise-p.final_amount_paise;',E'discount:=p.calculated_total_paise-p.final_amount_paise;\n if p_expected_amount_paise is not null and p_expected_amount_paise<>greatest(0,subtotal-discount) then raise exception ''correction changed; review the refreshed amount''; end if;');
 drop function public.correct_bill(uuid);
 execute definition;
end $$;
revoke execute on function public.correct_bill(uuid,bigint) from public,anon,authenticated;
grant execute on function public.correct_bill(uuid,bigint) to authenticated;
