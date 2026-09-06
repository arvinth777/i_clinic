import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import ws from 'ws'

function loadEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    out[t.slice(0, eq)] = t.slice(eq + 1)
  }
  return out
}
const appEnv = loadEnv('.env.local')
const userEnv = loadEnv('.env.test-users.local')
const SUPABASE_URL = appEnv.VITE_SUPABASE_URL
const ANON_KEY = appEnv.VITE_SUPABASE_ANON_KEY
const CLINIC_A_ID = '23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
const FN_URL = `${SUPABASE_URL}/functions/v1/admin-create-login`

const results = []
function report(label, pass, detail) {
  results.push({ label, pass })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ' -- ' + detail : ''}`)
}

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { realtime: { transport: ws } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

const adminOnly = await signIn('admin.only@staging.test', userEnv.TEST_ADMIN_ONLY_PASSWORD)
// doctor.a is NOT a useful "non-admin" test subject -- per AGENTS.md, the
// doctor legitimately holds {doctor, admin} alongside the dedicated
// admin-only account. reception.a holds only 'receptionist' and is the
// genuine negative case.
const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)

// no Authorization header at all
{
  const res = await fetch(FN_URL, { method: 'POST', body: JSON.stringify({ email: 'x@x.com', password: 'x', role: 'doctor', clinic_id: CLINIC_A_ID }) })
  report('rejects a request with no Authorization header', res.status === 401, `status ${res.status}`)
}

// signed in, but not an admin
{
  const { data: sessionData } = await receptionA.auth.getSession()
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionData.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `should-not-exist-${Date.now()}@staging.test`, password: 'Password@test123', role: 'doctor', clinic_id: CLINIC_A_ID }),
  })
  const body = await res.json()
  report('rejects a non-admin caller (reception.a)', res.status === 403, `status ${res.status}, ${JSON.stringify(body)}`)
}

// real admin, real create
let newUserId = null
const newEmail = `phase-a-test-${Date.now()}@staging.test`
{
  const { data: sessionData } = await adminOnly.auth.getSession()
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionData.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: newEmail, password: 'Password@test123', role: 'receptionist', clinic_id: CLINIC_A_ID }),
  })
  const body = await res.json()
  newUserId = body.user_id
  report('admin can create a new login', res.status === 200 && !!newUserId, `status ${res.status}, ${JSON.stringify(body)}`)
}

// the new account can actually sign in and holds the right role
{
  const fresh = await signIn(newEmail, 'Password@test123')
  const { data: userData } = await fresh.auth.getUser()
  report('the newly created login can sign in', userData?.user?.email === newEmail, JSON.stringify(userData?.user?.email))

  const { data: roleRow } = await fresh.from('user_roles').select('role').eq('user_id', userData.user.id).eq('clinic_id', CLINIC_A_ID).single()
  report('the newly created login holds the assigned role', roleRow?.role === 'receptionist', JSON.stringify(roleRow))
}

// cleanup: remove the role (admin's existing, already-RLS-permitted delete)
// and the underlying test auth account so staging doesn't accumulate these
{
  const { error: roleDelErr } = await adminOnly.from('user_roles').delete().eq('user_id', newUserId).eq('clinic_id', CLINIC_A_ID)
  report('admin can remove the role directly (no Edge Function needed)', !roleDelErr, roleDelErr?.message)
}

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) for (const f of failed) console.log(`  FAIL - ${f.label}`)
console.log(`\nNote: the test auth account (${newEmail}, id ${newUserId}) was NOT deleted -- this script signs in with the anon key only and has no service-role access to auth.admin.deleteUser. It has no role anywhere now (see the last check above) so it can sign in but do nothing.`)
if (failed.length) process.exitCode = 1
