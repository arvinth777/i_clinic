-- Same recurring gotcha as merge_patients (docs/STATUS.md): "revoke ...
-- from public" does not touch Supabase's separate schema-level default
-- privilege grant straight to anon. Checked via
-- information_schema.routine_privileges right after applying the Phase B
-- migration -- found all four new RPCs still EXECUTE-able by anon.
--
-- Not a live exploit (these are security invoker; RLS on every
-- underlying table already fails closed for anon, same reasoning as
-- confirm_bill's own anon/authenticated revoke), but defense in depth,
-- same posture as everywhere else in this project.

revoke execute on function public.record_purchase(uuid, uuid, text, date, uuid, jsonb) from anon, authenticated;
grant execute on function public.record_purchase(uuid, uuid, text, date, uuid, jsonb) to authenticated;

revoke execute on function public.create_stock_transfer(uuid, uuid, uuid, uuid, int, text) from anon, authenticated;
grant execute on function public.create_stock_transfer(uuid, uuid, uuid, uuid, int, text) to authenticated;

revoke execute on function public.record_stock_count(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.record_stock_count(uuid, uuid, jsonb) to authenticated;

revoke execute on function public.adjust_stock(uuid, uuid, uuid, int, text) from anon, authenticated;
grant execute on function public.adjust_stock(uuid, uuid, uuid, int, text) to authenticated;
