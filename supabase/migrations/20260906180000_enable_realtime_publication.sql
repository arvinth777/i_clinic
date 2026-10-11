-- Root cause of the "realtime sync" complaint: RLS being enabled on a
-- table has nothing to do with whether it's actually published to
-- Realtime. Checked directly:
--   select * from pg_publication_tables where pubname = 'supabase_realtime';
-- returned zero rows -- the publication exists (puballtables = false) but
-- no table had ever been added to it. Every `.channel(...).on('postgres_
-- changes', ...)` subscription in the frontend (TokenList.tsx, Consultation.
-- tsx on `visits`; PricingPanel.tsx, Billing.tsx on `visit_pricing`) was
-- therefore listening to a stream that could never emit anything. The
-- ~20-30s "sync" observed in testing was entirely the query client's
-- refetchInterval polling fallback (queryClient.ts / Consultation.tsx),
-- not realtime delivery arriving late -- it was never arriving at all.
--
-- REPLICA IDENTITY was DEFAULT (primary key only) on all three tables.
-- RLS-filtered Realtime needs the full old row image to evaluate policies
-- against an UPDATE/DELETE, which DEFAULT doesn't provide -- set to FULL
-- alongside the publication fix so policy evaluation actually has what it
-- needs, not just so the subscription exists.
--
-- bills has no frontend subscriber today (nothing in src/ subscribes to
-- it), but is added for the same reason a billing-adjacent screen would
-- reasonably want it next, and because it was explicitly asked for.

alter table public.visits replica identity full;
alter table public.visit_pricing replica identity full;
alter table public.bills replica identity full;

alter publication supabase_realtime add table public.visits;
alter publication supabase_realtime add table public.visit_pricing;
alter publication supabase_realtime add table public.bills;
