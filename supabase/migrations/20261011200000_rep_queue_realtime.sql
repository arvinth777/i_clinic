-- Rep arrivals and cross-role event messages use the same invalidate-and-refetch path as patient arrivals.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pharma_rep_checkins') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pharma_rep_checkins;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'queue_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_events;
  END IF;
END $$;
