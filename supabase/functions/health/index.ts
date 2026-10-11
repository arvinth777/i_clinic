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
// Uses the anon key, not the service role -- a publicly-callable function
// holding service_role is a liability with no upside once the anon key can
// prove the same thing. Calls public.health_ping() (migration
// 20260907010000) rather than reading `clinics` directly: clinics_select's
// RLS calls has_any_clinic_role(id), and anon was deliberately never
// granted EXECUTE on that helper (a real, correct hardening decision --
// see the migration's own comment), so a raw anon-key read against
// `clinics` fails closed with a Postgres permission error, not a clean
// empty result. health_ping() is a narrow SECURITY DEFINER function that
// does nothing but confirm `clinics` is queryable and return a bare
// boolean -- granted to anon alone, it proves the same thing a direct
// table read would ("Postgres answered", zero rows included) without
// reopening RLS-helper access anywhere else in the schema.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async () => {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)

  const { error } = await client.rpc('health_ping')

  return new Response(JSON.stringify({ ok: !error }), {
    status: error ? 500 : 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
