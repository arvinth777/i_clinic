// Keep-alive health check (docs/architecture-spec.md's "Supabase keep-alive"
// monitoring signal). Supabase Free projects pause after 7 days with no
// database request; the clinic's machine is off every night and all Sunday,
// so a week's holiday alone would trigger that with nobody touching the app.
// An external uptime monitor pings this on its own schedule (not a GitHub
// Actions cron -- a dormant repo must never be able to silence it).
//
// Public on purpose: an uptime monitor can't hold a Supabase user session,
// and this function accepts no caller input and returns no data beyond
// {"ok":true/false} -- there is nothing here for an unauthenticated caller
// to learn or influence. verify_jwt is disabled for this function alone in
// supabase/config.toml, which must ship with this file or a redeploy from
// the CLI silently re-enables JWT verification and breaks the public ping.
//
// Uses the service role key (auto-provided in every Edge Function's
// environment) specifically so this is a real read regardless of RLS --
// an anon-key read against `clinics` would be filtered to zero rows by
// clinics_select's role check and prove nothing.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async () => {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { error } = await client.from('clinics').select('id').limit(1)

  return new Response(JSON.stringify({ ok: !error }), {
    status: error ? 500 : 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
