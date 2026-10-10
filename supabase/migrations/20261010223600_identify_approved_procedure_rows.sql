-- A procedure may occur twice in one visit; review each supplied row separately.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.build_approval_lines(uuid,boolean)'::regprocedure);
 execute replace(definition,'''procedure_id'',vp.procedure_id','''visit_procedure_id'',vp.id,''procedure_id'',vp.procedure_id');
 definition:=pg_get_functiondef('public.approval_financial_lines(jsonb)'::regprocedure);
 execute replace(definition,'''procedure_id'',l->''procedure_id''','''visit_procedure_id'',l->''visit_procedure_id'',''procedure_id'',l->''procedure_id''');
end $$;
