// TDD for the Phase G fix pass (docs/STATUS.md's ranked findings). One
// section per finding, in the same severity order the fix pass itself
// follows -- each section's own comment says which finding it closes and
// whether it was genuinely red before that finding's fix landed. Same
// convention as every other script: plain, against live staging, signed
// in as the real roles, no framework.
//
// Run from the project root: node scripts/phase-g-fixes-test.mjs

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

const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)
const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)
const adminOnly = await signIn('admin.only@staging.test', userEnv.TEST_ADMIN_ONLY_PASSWORD)

console.log('\nsigned in as doctor.a, reception.a, admin.only\n')

// ============================================================
// Section 1: Critical finding #3 -- consultation fee has no admin setter
// anywhere. Genuinely red before migration 20260907030000_admin_set_
// clinic_fee.sql: admin_set_clinic_fee doesn't exist pre-migration, so
// every call in this section throws "could not find the function".
// ============================================================
{
  const { data: before } = await doctorA.from('clinics').select('consultation_fee_paise').eq('id', CLINIC_A_ID).single()

  const { error: recErr } = await receptionA.rpc('admin_set_clinic_fee', { p_clinic_id: CLINIC_A_ID, p_fee_paise: 1 })
  report('reception cannot set the consultation fee', !!recErr, recErr?.message)

  // Not testing "doctor blocked" here: doctor.a holds {doctor, admin} at
  // Clinic A (docs/STATUS.md's own documented roster), so a doctor-role
  // call legitimately succeeds -- same reasoning admin_set_clinic_upi_vpa's
  // own test (settle-bill-test.mjs) already follows, only ever checking
  // reception for this class of RPC.

  const { error: negErr } = await adminOnly.rpc('admin_set_clinic_fee', { p_clinic_id: CLINIC_A_ID, p_fee_paise: -100 })
  report('a negative fee is rejected', !!negErr, negErr?.message)

  const testFee = 30000 + Math.floor(Math.random() * 100) // distinct from the real value, still a plausible paise amount
  const { error: setErr } = await adminOnly.rpc('admin_set_clinic_fee', { p_clinic_id: CLINIC_A_ID, p_fee_paise: testFee })
  report('admin can set the consultation fee', !setErr, setErr?.message)

  const { data: after } = await doctorA.from('clinics').select('consultation_fee_paise').eq('id', CLINIC_A_ID).single()
  report('the new fee is saved', after?.consultation_fee_paise === testFee, JSON.stringify(after))

  // restore the original staging value so other scripts/manual testing
  // aren't disrupted
  await adminOnly.rpc('admin_set_clinic_fee', { p_clinic_id: CLINIC_A_ID, p_fee_paise: before?.consultation_fee_paise ?? 25000 })
}

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
