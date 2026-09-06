// TDD for the "stuck visit" bug found via a live end-to-end flow test:
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

async function setStage(client, visitId, stage) {
  const { error } = await client.from('visits').update({ stage }).eq('id', visitId)
  if (error) throw new Error(`setting stage=${stage} failed: ${error.message}`)
}

const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)
const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)

// -------------------------------------------------------------
// Case 1: a consultation finished with pricing never touched -- the exact
// shape of the bug found live (confirming a prescription used to do this
// automatically; "Consultation done" alone, with nothing else clicked, does
// it too, and is the legitimate case this backstop exists for).
// -------------------------------------------------------------
{
  const visitId = await makeVisit(doctorA, 'Packing-untouched-pricing fixture')
  await setStage(doctorA, visitId, 'with_doctor')

  const before = await readPricing(doctorA, visitId)
  report(
    'fresh with_doctor visit: final_amount_set is false, final_amount tracks the fee',
    before.final_amount_set === false && before.final_amount_paise === 25000,
    JSON.stringify(before),
  )

  // "Consultation done" (or the old buggy prescription-confirm path) --
  // reaching packing without ever touching visit_pricing.
  await setStage(doctorA, visitId, 'packing')

  const afterPacking = await readPricing(doctorA, visitId)
  report(
    'reaching packing auto-confirms final_amount_set, without changing the amount or bumping revision',
    afterPacking.final_amount_set === true &&
      afterPacking.final_amount_paise === before.final_amount_paise &&
      afterPacking.revision_number === before.revision_number,
    JSON.stringify(afterPacking),
  )

  // The actual end-to-end proof: reception can now bill and collect.
  await setStage(receptionA, visitId, 'ready_at_reception')
  const { data: billId, error: confirmErr } = await receptionA.rpc('confirm_bill', {
    p_visit_id: visitId,
    p_payment_method: 'cash',
  })
  report('confirm_bill now succeeds for a visit that reached packing with pricing untouched', !confirmErr && !!billId, confirmErr?.message ?? `bill ${billId}`)
}

// -------------------------------------------------------------
// Case 2: a doctor who DID set a real discount before finishing -- the
// backstop must never override a genuine choice, including a deliberate
// zero.
// -------------------------------------------------------------
{
  const visitId = await makeVisit(doctorA, 'Packing-doctor-set-zero fixture')
  await setStage(doctorA, visitId, 'with_doctor')

  const { error: setErr } = await doctorA.from('visit_pricing').update({ final_amount_paise: 0 }).eq('visit_id', visitId)
  if (setErr) throw new Error(`setting final_amount to 0 failed: ${setErr.message}`)
  const afterSet = await readPricing(doctorA, visitId)
  report('doctor sets final amount to 0 (a free consultation): final_amount_set flips true', afterSet.final_amount_set === true && afterSet.final_amount_paise === 0, JSON.stringify(afterSet))

  await setStage(doctorA, visitId, 'packing')
  const afterPacking = await readPricing(doctorA, visitId)
  report(
    'the backstop does not override an already-set amount, including a deliberate zero',
    afterPacking.final_amount_set === true && afterPacking.final_amount_paise === 0 && afterPacking.revision_number === afterSet.revision_number,
    JSON.stringify(afterPacking),
  )
}

const failed = results.filter((r) => !r.pass)
console.log(`\n== Summary ==\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
