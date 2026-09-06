// TDD for Phase F (docs/build-plan.md): offline. The DB-level contract
// only -- the browser-level flows (network cut mid-consultation/
// mid-billing/at-print, reload while offline) are covered separately by a
// throwaway Playwright script per convention, not here.
//
// confirm_bill grew two new optional parameters (a client-side snapshot of
// final_amount_paise/revision_number, taken at the moment reception clicks
// confirm) so the offline mutation queue can replay a confirm against what
// she actually saw, not whatever is live by the time the queue drains --
// docs/architecture-spec.md's "never silently apply a stale price" money-
// conflict design. This script is the genuinely-red part of this phase:
// the 4-arg signature doesn't exist before the migration. The idempotency
// assertion (Section 3) is expected to pass even pre-migration, since it
// exercises a mechanism (confirm_bill's existing v_stage='paid' early
// return) that already shipped in Phase B/C -- noted here rather than
// implied, since this project corrects overstated red-run claims on sight.
//
// Run before the migration exists: Sections 1-2 throw (4-arg call doesn't
// resolve), Section 3 passes already, Section 4 (the pre-existing seed
// case) passes already. Run again after: everything passes.
//
// Run from the project root: node scripts/phase-f-test.mjs

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

async function makeVisit(complaint) {
  const stamp = Date.now() + Math.random()
  const { data: patient, error: patientErr } = await doctorA.from('patients').insert({ clinic_id: CLINIC_A_ID, name: `Offline Test Patient ${stamp}`, age: 40 }).select('id').single()
  if (patientErr) throw new Error(`fixture: creating patient failed: ${patientErr.message}`)
  const { data: visit, error: visitErr } = await doctorA.from('visits').insert({ clinic_id: CLINIC_A_ID, patient_id: patient.id, arrived_at: new Date().toISOString(), complaint }).select('id').single()
  if (visitErr) throw new Error(`fixture: creating visit failed: ${visitErr.message}`)
  return visit.id
}

// Drives a visit up to ready_at_reception with a final amount set, without
// calling confirm_bill -- that's this script's own job, with whatever
// snapshot args each section wants to exercise.
async function readyForBilling(visitId, finalAmountPaise) {
  await doctorA.from('visits').update({ stage: 'with_doctor' }).eq('id', visitId)
  await doctorA.from('visit_pricing').update({ final_amount_paise: finalAmountPaise }).eq('visit_id', visitId)
  await doctorA.from('visits').update({ stage: 'packing' }).eq('id', visitId)
  await receptionA.from('visits').update({ stage: 'ready_at_reception' }).eq('id', visitId)
}

async function pricingOf(visitId) {
  const { data, error } = await doctorA.from('visit_pricing').select('final_amount_paise, revision_number').eq('visit_id', visitId).single()
  if (error) throw new Error(`reading visit_pricing failed: ${error.message}`)
  return data
}

const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)
const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)
console.log('signed in as doctor.a, reception.a\n')

// ================================================================
// Section 1 -- stale snapshot: the doctor's revision lands (syncs in)
// before reception's queued confirm replays. The bill must carry what
// reception's screen actually showed (the snapshot), not the live figure,
// and must be flagged needs_reconciliation -- never silently corrected.
// ================================================================
{
  const visitId = await makeVisit('offline test: stale snapshot')
  await readyForBilling(visitId, 18000)
  const snapshot = await pricingOf(visitId) // what reception's screen showed: 18000 @ some revision

  // The doctor revises again -- their own device's queued pricing update
  // syncing in first, representing the ordering that actually happens
  // offline: two devices, no shared ordering guarantee across them.
  await doctorA.from('visit_pricing').update({ final_amount_paise: 12000 }).eq('visit_id', visitId)
  const live = await pricingOf(visitId)
  report('setup: the doctor\'s later revision actually moved the live revision_number', live.revision_number > snapshot.revision_number, JSON.stringify({ snapshot, live }))

  const { data: billId, error } = await receptionA.rpc('confirm_bill', {
    p_visit_id: visitId,
    p_payment_method: 'cash',
    p_snapshot_final_amount_paise: snapshot.final_amount_paise,
    p_snapshot_revision_number: snapshot.revision_number,
  })
  report('confirm_bill accepts the 4-arg snapshot form', !error, error?.message)

  const { data: bill } = await doctorA.from('bills').select('final_amount_paise, pricing_revision_at_confirm, needs_reconciliation').eq('id', billId).single()
  report('the bill is billed at the snapshotted amount (18000), not the live one (12000)', bill?.final_amount_paise === 18000, JSON.stringify(bill))
  report('the bill carries the snapshotted revision, not the live one', bill?.pricing_revision_at_confirm === snapshot.revision_number, JSON.stringify(bill))
  report('the bill is flagged needs_reconciliation', bill?.needs_reconciliation === true, JSON.stringify(bill))

  const after = await pricingOf(visitId)
  report('visit_pricing itself is never touched by billing (still the doctor\'s 12000)', after.final_amount_paise === 12000, JSON.stringify(after))
}

// ================================================================
// Section 2 -- matching snapshot: nothing moved between click and replay
// (the common case, online or offline) -- bills normally, no flag.
// ================================================================
{
  const visitId = await makeVisit('offline test: matching snapshot')
  await readyForBilling(visitId, 22000)
  const snapshot = await pricingOf(visitId)

  const { data: billId, error } = await receptionA.rpc('confirm_bill', {
    p_visit_id: visitId,
    p_payment_method: 'cash',
    p_snapshot_final_amount_paise: snapshot.final_amount_paise,
    p_snapshot_revision_number: snapshot.revision_number,
  })
  report('confirm_bill (matching snapshot) succeeds', !error, error?.message)

  const { data: bill } = await doctorA.from('bills').select('final_amount_paise, needs_reconciliation').eq('id', billId).single()
  report('bills at the snapshotted amount', bill?.final_amount_paise === 22000, JSON.stringify(bill))
  report('not flagged -- nothing actually moved', bill?.needs_reconciliation === false, JSON.stringify(bill))

  // Backward compatibility: the plain 2-arg call (every existing caller --
  // Billing.tsx's online path, every earlier test script) must still
  // resolve and behave exactly as before this migration (live read).
  const visitId2 = await makeVisit('offline test: plain 2-arg call unaffected')
  await readyForBilling(visitId2, 9000)
  const { data: billId2, error: error2 } = await receptionA.rpc('confirm_bill', { p_visit_id: visitId2, p_payment_method: 'cash' })
  report('the plain 2-arg confirm_bill call still resolves (no ambiguous-function error)', !error2, error2?.message)
  const { data: bill2 } = await doctorA.from('bills').select('final_amount_paise, needs_reconciliation').eq('id', billId2).single()
  report('2-arg call bills at the live amount, unflagged', bill2?.final_amount_paise === 9000 && bill2?.needs_reconciliation === false, JSON.stringify(bill2))
}

// ================================================================
// Section 3 -- idempotent replay: the same queued confirm_bill call fired
// twice (a client retry after a success it never heard back from) must
// deduct stock once, not twice. Pre-existing mechanism (v_stage='paid'
// early return, shipped in Phase B/C) -- this section is expected to pass
// even before this migration's changes.
// ================================================================
{
  const stamp = Date.now() + Math.random()
  const { data: med, error: medErr } = await doctorA.from('medicines').insert({ clinic_id: CLINIC_A_ID, name: `Offline Idempotency Med ${stamp}`, price_paise: 500 }).select('id').single()
  if (medErr) throw new Error(`fixture: creating medicine failed: ${medErr.message}`)

  const { data: point } = await doctorA.from('stock_points').select('id').eq('clinic_id', CLINIC_A_ID).eq('name', 'Counter').single()
  const { data: supplier, error: supplierErr } = await doctorA.from('suppliers').insert({ clinic_id: CLINIC_A_ID, name: `Offline Test Supplier ${stamp}` }).select('id').single()
  if (supplierErr) throw new Error(`fixture: creating supplier failed: ${supplierErr.message}`)
  const { error: purchaseErr } = await doctorA.rpc('record_purchase', {
    p_clinic_id: CLINIC_A_ID,
    p_supplier_id: supplier.id,
    p_invoice_number: `offline-test-${stamp}`,
    p_purchase_date: new Date().toISOString().slice(0, 10),
    p_stock_point_id: point.id,
    p_items: [{ medicine_id: med.id, quantity: 20, cost_price_paise: 200 }],
  })
  if (purchaseErr) throw new Error(`fixture: stocking the medicine failed: ${purchaseErr.message}`)

  const visitId = await makeVisit('offline test: idempotent replay')
  const { data: rx, error: rxErr } = await doctorA.from('prescriptions').insert({ clinic_id: CLINIC_A_ID, visit_id: visitId }).select('id').single()
  if (rxErr) throw new Error(`fixture: creating prescription failed: ${rxErr.message}`)
  const { data: item, error: itemErr } = await doctorA
    .from('prescription_items')
    .insert({ clinic_id: CLINIC_A_ID, prescription_id: rx.id, medicine_id: med.id, duration_days: 5, quantity_dispensed: 2 })
    .select('id')
    .single()
  if (itemErr) throw new Error(`fixture: prescribing failed: ${itemErr.message}`)

  await readyForBilling(visitId, 25000)
  const snapshot = await pricingOf(visitId)
  const args = {
    p_visit_id: visitId,
    p_payment_method: 'cash',
    p_snapshot_final_amount_paise: snapshot.final_amount_paise,
    p_snapshot_revision_number: snapshot.revision_number,
  }

  const { data: billId1, error: err1 } = await receptionA.rpc('confirm_bill', args)
  report('first confirm_bill call succeeds', !err1, err1?.message)

  // Replay: the exact same call, as the offline queue would fire it again
  // if it never heard back from the first attempt.
  const { data: billId2, error: err2 } = await receptionA.rpc('confirm_bill', args)
  report('replayed confirm_bill call succeeds (no error, not a duplicate-key crash)', !err2, err2?.message)
  report('the replay returns the same bill id, not a new one', billId1 === billId2, JSON.stringify({ billId1, billId2 }))

  const { data: bills } = await doctorA.from('bills').select('id').eq('visit_id', visitId)
  report('exactly one bill row exists for the visit despite two confirm_bill calls', (bills ?? []).length === 1, JSON.stringify(bills))

  const { data: movements } = await doctorA.from('stock_movements').select('id, quantity_delta').eq('reference_id', item.id).eq('reason', 'dispensed')
  report('stock moved exactly once for the dispensed item (not twice)', (movements ?? []).length === 1 && movements[0].quantity_delta === -2, JSON.stringify(movements))
}

// ================================================================
// Section 4 -- the pre-existing seed case (Ganesan Pillai): a visit
// closed offline, bill synced first (matching at insert), the doctor's
// contradicting revision arrived moments later. The insert-time trigger
// cannot catch this ordering (already documented in the seed migration);
// bills_needing_reconciliation, a live view, does. Confirm it still lands
// as needs_reconciliation via the view, and the bill row itself is
// byte-for-byte untouched (never overwritten, non-negotiable #3) --
// exercised here as this phase's own check, not a new fixture.
// ================================================================
{
  const { data: patient } = await doctorA.from('patients').select('id').eq('clinic_id', CLINIC_A_ID).eq('name', 'Ganesan Pillai').single()
  report('seed patient Ganesan Pillai exists', !!patient, JSON.stringify(patient))

  const { data: visit } = await doctorA.from('visits').select('id').eq('patient_id', patient.id).single()
  const { data: bill } = await doctorA.from('bills').select('id, final_amount_paise, pricing_revision_at_confirm, needs_reconciliation').eq('visit_id', visit.id).single()

  report('the seed bill is exactly as originally inserted (25000 @ revision 0)', bill.final_amount_paise === 25000 && bill.pricing_revision_at_confirm === 0, JSON.stringify(bill))
  report('its own stored needs_reconciliation flag is false (this ordering, by design, the insert trigger cannot catch)', bill.needs_reconciliation === false, JSON.stringify(bill))

  const { data: flagged } = await doctorA.from('bills_needing_reconciliation').select('id').eq('id', bill.id).maybeSingle()
  report('bills_needing_reconciliation (the live view) catches it anyway', !!flagged, JSON.stringify(flagged))

  const { data: report_ } = await doctorA.rpc('get_daily_report', {})
  report('get_daily_report\'s needs_reconciliation_count is at least 1 (this seed row alone guarantees it)', (report_?.[0]?.needs_reconciliation_count ?? 0) >= 1, JSON.stringify(report_?.[0]))
}

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
