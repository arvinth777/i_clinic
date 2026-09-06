// Phase A (docs/build-plan.md): "Logins -- add ... staff/doctor accounts,
// assign roles via user_roles." Creating a new auth.users row needs the
// service role (auth.admin.createUser) -- a client-side insert can't do
// this safely, so it's an Edge Function, same pattern as
// supabase/functions/health.
//
// Removing a login/role is NOT here: user_roles' own RLS already lets an
// admin DELETE a role assignment directly (has_clinic_role(clinic_id,
// 'admin') -- confirmed via pg_policies before writing this), no
// elevated privilege needed. Deliberately not deleting the underlying
// auth.users account on "remove" either -- that's revoking this clinic's
// access, not erasing an identity that (per AGENTS.md) may hold roles at
// another clinic once a second one exists.
//
// verify_jwt stays at its default (true) for this function -- unlike
// health, this one performs a real privileged write and must only ever
// run for an authenticated caller. The admin check below is still done
// explicitly in the function body (not just left to RLS) -- the same
// "belt and suspenders" pattern confirm_bill and merge_patients use.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const ROLES = ['doctor', 'receptionist', 'admin']

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'missing Authorization header' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }

  let body: { email?: string; password?: string; role?: string; clinic_id?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  const { email, password, role, clinic_id } = body
  if (!email || !password || !role || !clinic_id) {
    return new Response(JSON.stringify({ error: 'email, password, role, and clinic_id are all required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (!ROLES.includes(role)) {
    return new Response(JSON.stringify({ error: `role must be one of ${ROLES.join(', ')}` }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  // Bound to the caller's own JWT -- RLS decides what they can see, so this
  // query only ever succeeds if the caller genuinely holds admin for this
  // clinic. Never trust the client-sent clinic_id alone for authorization.
  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  // limit(1): more than one user can legitimately hold admin for the same
  // clinic (per AGENTS.md, the doctor holds {doctor, admin} alongside a
  // dedicated admin-only account) -- maybeSingle() alone errors the moment
  // a second admin row for this clinic is visible under RLS.
  const { data: adminRow, error: adminCheckErr } = await callerClient
    .from('user_roles')
    .select('id')
    .eq('clinic_id', clinic_id)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (adminCheckErr || !adminRow) {
    return new Response(JSON.stringify({ error: 'only admin can create a login' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }

  const serviceClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: created, error: createErr } = await serviceClient.auth.admin.createUser({ email, password, email_confirm: true })
  if (createErr || !created.user) {
    return new Response(JSON.stringify({ error: createErr?.message ?? 'could not create the account' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const { error: roleErr } = await serviceClient.from('user_roles').insert({ user_id: created.user.id, clinic_id, role })
  if (roleErr) {
    // Roll back the orphaned auth account rather than leave a login that
    // can sign in but holds no role anywhere.
    await serviceClient.auth.admin.deleteUser(created.user.id)
    return new Response(JSON.stringify({ error: roleErr.message }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  return new Response(JSON.stringify({ user_id: created.user.id }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
