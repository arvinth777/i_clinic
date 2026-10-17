import { assertStaging } from './clinic-workflow-fixture.mjs'
import { consultationOnlyFixture, payVisitResult } from './clinic-workflow-fixture.mjs'
// Approval/handoff regression: the old packing backstop is superseded by explicit approval.
// Historical context for the original stuck-visit bug:
// finishing a consultation (reaching stage=packing) with visit_pricing.
// final_amount_set still false left a visit permanently unbillable -- no
// screen in the app can touch visit_pricing once a visit leaves
// with_doctor/waiting. Fixed by 20260906160000_ensure_final_amount_set_on_
// packing.sql (a backstop trigger) plus removing PrescriptionForm.tsx's own
// stray stage='packing' write (the most common way a visit reached packing
// with pricing untouched -- confirming a prescription, before ever reaching
// the pricing panel).
//
// Same convention as billing-test.mjs/pricing-test.mjs: a plain script
// against live staging, signed in as the real roles, no framework. Run from
// the project root: node scripts/packing-final-amount-test.mjs
//
// Run before the migration exists, this is expected to show
// final_amount_set still false after reaching packing -- that's red.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import ws from 'ws'

function loadEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return out
}

const appEnv = loadEnv('.env.local')
const userEnv = loadEnv('.env.test-users.local')

const SUPABASE_URL = appEnv.VITE_SUPABASE_URL
assertStaging(SUPABASE_URL)
const ANON_KEY = appEnv.VITE_SUPABASE_ANON_KEY
const CLINIC_A_ID = '23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'

const results = []
function report(label, pass, detail) {
  results.push({ label, pass })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ' -- ' + detail : ''}`)
}

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: ws } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

async function makeVisit(doctorA, complaint) {
  const stamp = Date.now() + Math.random()
  const { data: patient, error: patientErr } = await doctorA
    .from('patients')
    .insert({ clinic_id: CLINIC_A_ID, name: `Packing Test Patient ${stamp}`, age: 40 })
    .select('id')
    .single()
  if (patientErr) throw new Error(`fixture: creating patient failed: ${patientErr.message}`)

  const { data: visit, error: visitErr } = await doctorA
    .from('visits')
    .insert({ clinic_id: CLINIC_A_ID, patient_id: patient.id, arrived_at: new Date().toISOString(), complaint })
    .select('id')
    .single()
  if (visitErr) throw new Error(`fixture: creating visit failed: ${visitErr.message}`)
  return visit.id
}

async function readPricing(client, visitId) {
  const { data, error } = await client
    .from('visit_pricing')
    .select('calculated_total_paise, final_amount_paise, revision_number, final_amount_set')
    .eq('visit_id', visitId)
    .single()
  if (error) throw new Error(`reading visit_pricing failed: ${error.message}`)
  return data
}

const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)
const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)
for (const amount of [25000, 0]) {
  const visitId = await makeVisit(doctorA, 'Synthetic approval-before-finish regression')
  const before = await readPricing(doctorA, visitId)
  report('fresh visit has no approved final amount', before.final_amount_set === false)
  const bypass = await doctorA.from('visits').update({ stage: 'ready_to_bill' }).eq('id', visitId)
  report('direct stage write cannot bypass doctor approval', !!bypass.error)
  const early = await receptionA.rpc('confirm_reception_bill', { p_visit_id: visitId, p_payment_method: 'cash', p_expected_total_paise: 0, p_items: [] })
  report('unapproved visit cannot be billed', !!early.error)
  await consultationOnlyFixture(doctorA, receptionA, CLINIC_A_ID, visitId, amount)
  const after = await readPricing(doctorA, visitId)
  report('explicit approval preserves the doctor amount, including zero', after.final_amount_set && after.final_amount_paise === amount)
  const paid = await payVisitResult(receptionA, visitId)
  report('approved finished consultation can be billed', !paid.error && !!paid.data, paid.error?.message)
}
const failed = results.filter(r => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
