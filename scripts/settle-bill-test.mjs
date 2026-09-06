// TDD for Phase C (docs/build-plan.md): payments completed. Cash and
// UPI already worked before this phase (Billing.tsx already builds a
// real UPI QR and lets confirm_bill close a visit with payment_method
// 'pay_later') -- this script also pins that down, so the whole
// "Done when" line is verified, not just the new settlement piece.
// Same convention as every other script: plain, against live staging,
// signed in as the real roles, no framework.
//
// Run before the migration exists, the settle_bill/unpaid_bills/
// admin_set_clinic_upi_vpa sections are expected to throw -- that's red.
// Run again after the migration is applied, everything should pass.
//
// Run from the project root: node scripts/settle-bill-test.mjs

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

async function makeVisit(client, complaint) {
  const stamp = Date.now() + Math.random()
  const { data: patient, error: patientErr } = await client.from('patients').insert({ clinic_id: CLINIC_A_ID, name: `Settle Test Patient ${stamp}`, age: 33 }).select('id').single()
  if (patientErr) throw new Error(`fixture: creating patient failed: ${patientErr.message}`)
  const { data: visit, error: visitErr } = await client.from('visits').insert({ clinic_id: CLINIC_A_ID, patient_id: patient.id, arrived_at: new Date().toISOString(), complaint }).select('id').single()
  if (visitErr) throw new Error(`fixture: creating visit failed: ${visitErr.message}`)
  return visit.id
}

async function billAsPayLater(visitId) {
  await doctorA.from('visits').update({ stage: 'with_doctor' }).eq('id', visitId)
  await doctorA.from('visits').update({ stage: 'packing' }).eq('id', visitId)
  await receptionA.from('visits').update({ stage: 'ready_at_reception' }).eq('id', visitId)
  const { data: billId, error } = await receptionA.rpc('confirm_bill', { p_visit_id: visitId, p_payment_method: 'pay_later' })
  if (error) throw new Error(`confirm_bill (pay_later) failed: ${error.message}`)
  return billId
}

const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)
const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)
const adminOnly = await signIn('admin.only@staging.test', userEnv.TEST_ADMIN_ONLY_PASSWORD)
console.log('signed in as doctor.a, reception.a, admin.only\n')

// ================================================================
// Section 1 -- pay later / credit closes the visit as billed
// (pre-existing behaviour, pinned down here rather than assumed)
// ================================================================
let visitId, billId
{
  visitId = await makeVisit(doctorA, 'settle test visit')
  billId = await billAsPayLater(visitId)
  report('confirm_bill accepts pay_later and returns a bill id', !!billId)

  const { data: visit } = await doctorA.from('visits').select('stage').eq('id', visitId).single()
  report('the visit closes as paid/billed even on credit', visit?.stage === 'paid', JSON.stringify(visit))

  const { data: bill } = await doctorA.from('bills').select('payment_method').eq('id', billId).single()
  report('the bill is flagged pay_later, marking it unpaid', bill?.payment_method === 'pay_later', JSON.stringify(bill))
}

// ================================================================
// Section 2 -- the credit bill appears on the unpaid list
// ================================================================
{
  const { data: unpaid, error } = await receptionA.from('unpaid_bills').select('bill_id, patient_name, final_amount_paise').eq('bill_id', billId)
  report('the credit bill appears on the unpaid list', !error && (unpaid ?? []).length === 1, error?.message ?? JSON.stringify(unpaid))

  const { data: doctorSees } = await doctorA.from('unpaid_bills').select('bill_id').eq('bill_id', billId)
  report('doctor can also see the unpaid list (same access as bills_select)', (doctorSees ?? []).length === 1, JSON.stringify(doctorSees))

  const { data: adminSees, error: adminErr } = await adminOnly.from('unpaid_bills').select('bill_id').eq('bill_id', billId)
  report('admin sees nothing on the unpaid list (no patient-data exception)', !adminErr && (adminSees ?? []).length === 0, adminErr?.message ?? JSON.stringify(adminSees))
}

// ================================================================
// Section 3 -- settling records a new linked row, never mutating the
// original bill (non-negotiable #3: paid bills are immutable)
// ================================================================
{
  const { data: billBefore } = await doctorA.from('bills').select('*').eq('id', billId).single()

  const { error: adminSettleErr } = await adminOnly.rpc('settle_bill', { p_bill_id: billId, p_payment_method: 'cash' })
  report('admin cannot settle a bill', !!adminSettleErr, adminSettleErr?.message)

  const { data: settlementId, error: settleErr } = await receptionA.rpc('settle_bill', { p_bill_id: billId, p_payment_method: 'cash', p_notes: 'paid in person, follow-up visit' })
  report('reception can settle a pay_later bill', !settleErr && !!settlementId, settleErr?.message)

  const { data: billAfter } = await doctorA.from('bills').select('*').eq('id', billId).single()
  report('the original bill row is byte-for-byte unchanged', JSON.stringify(billBefore) === JSON.stringify(billAfter), 'diff if any: ' + JSON.stringify({ before: billBefore, after: billAfter }))

  const { data: settlement } = await receptionA.from('bill_settlements').select('bill_id, payment_method, notes').eq('id', settlementId).single()
  report('the settlement records how it was paid, linked to the original bill', settlement?.bill_id === billId && settlement?.payment_method === 'cash', JSON.stringify(settlement))
}

// ================================================================
// Section 4 -- settling removes the bill from the unpaid list, and a
// bill can't be settled twice
// ================================================================
{
  const { data: stillUnpaid } = await receptionA.from('unpaid_bills').select('bill_id').eq('bill_id', billId)
  report('a settled bill no longer appears on the unpaid list', (stillUnpaid ?? []).length === 0, JSON.stringify(stillUnpaid))

  const { error: doubleSettleErr } = await receptionA.rpc('settle_bill', { p_bill_id: billId, p_payment_method: 'upi' })
  report('a bill cannot be settled twice', !!doubleSettleErr, doubleSettleErr?.message)
}

// ================================================================
// Section 5 -- only a pay_later bill can be settled; only receptionist
// can settle
// ================================================================
{
  const cashVisitId = await makeVisit(doctorA, 'settle test cash visit')
  await doctorA.from('visits').update({ stage: 'with_doctor' }).eq('id', cashVisitId)
  await doctorA.from('visits').update({ stage: 'packing' }).eq('id', cashVisitId)
  await receptionA.from('visits').update({ stage: 'ready_at_reception' }).eq('id', cashVisitId)
  const { data: cashBillId } = await receptionA.rpc('confirm_bill', { p_visit_id: cashVisitId, p_payment_method: 'cash' })

  const { error: settleCashErr } = await receptionA.rpc('settle_bill', { p_bill_id: cashBillId, p_payment_method: 'cash' })
  report('a cash bill cannot be "settled" -- it was never unpaid', !!settleCashErr, settleCashErr?.message)

  const otherVisitId = await makeVisit(doctorA, 'settle test doctor-blocked visit')
  const otherBillId = await billAsPayLater(otherVisitId)
  const { error: doctorSettleErr } = await doctorA.rpc('settle_bill', { p_bill_id: otherBillId, p_payment_method: 'cash' })
  report('doctor cannot settle a bill (reception-only action)', !!doctorSettleErr, doctorSettleErr?.message)
}

// ================================================================
// Section 6 -- admin can configure the clinic's UPI VPA; no one else can
// ================================================================
{
  const { data: before } = await doctorA.from('clinics').select('upi_vpa').eq('id', CLINIC_A_ID).single()

  const { error: recErr } = await receptionA.rpc('admin_set_clinic_upi_vpa', { p_clinic_id: CLINIC_A_ID, p_upi_vpa: 'hijacked@upi' })
  report('reception cannot set the clinic UPI VPA', !!recErr, recErr?.message)

  const testVpa = `clinic-a-staging-${Date.now()}@upi`
  const { error: setErr } = await adminOnly.rpc('admin_set_clinic_upi_vpa', { p_clinic_id: CLINIC_A_ID, p_upi_vpa: testVpa })
  report('admin can set the clinic UPI VPA', !setErr, setErr?.message)

  const { data: after } = await doctorA.from('clinics').select('upi_vpa').eq('id', CLINIC_A_ID).single()
  report('the new UPI VPA is saved', after?.upi_vpa === testVpa, JSON.stringify(after))

  // restore the original staging value so other scripts/manual testing
  // aren't disrupted
  await adminOnly.rpc('admin_set_clinic_upi_vpa', { p_clinic_id: CLINIC_A_ID, p_upi_vpa: before?.upi_vpa ?? 'clinic-a-staging@upi' })
}

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
