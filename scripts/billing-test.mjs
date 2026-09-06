// TDD for the billing screen's backend (AGENTS.md Phase 3: money touches --
// tests before UI). Same convention as isolation-test.mjs/pricing-test.mjs:
// a plain script against live staging, signed in as the real roles, no
// framework. Run from the project root: node scripts/billing-test.mjs
//
// Unlike pricing-test.mjs, nothing here has landed on staging yet -- there
// is no partial-landing gate to skip around. Run before the migration
// exists, this script is expected to throw on its first read of
// final_amount_set/needs_reconciliation or its first confirm_bill/
// get_visit_billing_detail RPC call. That crash *is* red.
//
// Two bugs this migration also fixes, tested here rather than re-litigated
// in pricing-test.mjs (which predates them):
//   - an untouched final_amount_paise never tracked calculated_total
//     upward, fabricating a discount nobody set, whenever a procedure or
//     medicine was added before the doctor touched final_amount at all.
//   - nothing distinguished "final_amount happens to equal the total" from
//     "the doctor hasn't engaged with pricing yet" -- both looked identical
//     on the row, so there was no way to gate billing on it.
//
// All money is bigint paise end to end, including every fixture literal
// below -- never a rupee amount, never anything fractional/divided.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import ws from 'ws' // Node 20 has no native WebSocket the realtime client can use; browsers do.

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

async function readPricing(client, visitId) {
  const { data, error } = await client
    .from('visit_pricing')
    .select('calculated_total_paise, final_amount_paise, discount_paise, revision_number, final_amount_set')
    .eq('visit_id', visitId)
    .single()
  if (error) throw new Error(`reading visit_pricing failed: ${error.message}`)
  return data
}

async function makeVisit(doctorA, complaint) {
  const stamp = Date.now() + Math.random()
  const { data: patient, error: patientErr } = await doctorA
    .from('patients')
    .insert({ clinic_id: CLINIC_A_ID, name: `Billing Test Patient ${stamp}`, age: 50 })
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

async function makeProcedure(doctorA, name, price) {
  const { data, error } = await doctorA
    .from('procedures')
    .insert({ clinic_id: CLINIC_A_ID, name: `${name} ${Date.now()}${Math.random()}`, default_price_paise: price })
    .select('id')
    .single()
  if (error) throw new Error(`fixture: creating procedure failed: ${error.message}`)
  return data.id
}

async function makeMedicine(doctorA, name, price) {
  const { data, error } = await doctorA
    .from('medicines')
    .insert({ clinic_id: CLINIC_A_ID, name: `${name} ${Date.now()}${Math.random()}`, price_paise: price })
    .select('id')
    .single()
  if (error) throw new Error(`fixture: creating medicine failed: ${error.message}`)
  return data.id
}

async function addProcedureToVisit(doctorA, visitId, procedureId, price) {
  const { error } = await doctorA.from('visit_procedures').insert({ clinic_id: CLINIC_A_ID, visit_id: visitId, procedure_id: procedureId, price_paise: price })
  if (error) throw new Error(`adding visit_procedure failed: ${error.message}`)
}

async function prescribeToVisit(doctorA, visitId, medicineId) {
  const { data: rx, error: rxErr } = await doctorA.from('prescriptions').insert({ clinic_id: CLINIC_A_ID, visit_id: visitId }).select('id').single()
  if (rxErr) throw new Error(`fixture: creating prescription failed: ${rxErr.message}`)
  const { error } = await doctorA.from('prescription_items').insert({
    clinic_id: CLINIC_A_ID, prescription_id: rx.id, medicine_id: medicineId, duration_days: 5,
  })
  if (error) throw new Error(`prescribing failed: ${error.message}`)
}

async function main() {
  const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)
  const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)
  const { data: receptionAUser } = await receptionA.auth.getUser()
  console.log('signed in as doctor.a, reception.a\n')

  // ================================================================
  // Section 1 -- final_amount tracks calculated_total until the doctor
  // actually sets it; final_amount_set is the explicit "doctor engaged
  // with pricing" signal, independent of revision_number (which also
  // bumps on a plain recompute).
  // ================================================================
  const visit1 = await makeVisit(doctorA, 'billing arithmetic test fixture')
  console.log(`fixture visit 1 (arithmetic): ${visit1}`)

  {
    const p = await readPricing(doctorA, visit1)
    const ok = p.calculated_total_paise === 25000 && p.final_amount_paise === 25000 && p.discount_paise === 0 && p.final_amount_set === false
    report('fresh visit: final_amount_set is false', ok, JSON.stringify(p))
  }

  const proc1 = await makeProcedure(doctorA, 'Billing test procedure 1', 15000)
  await addProcedureToVisit(doctorA, visit1, proc1, 15000)
  {
    const p = await readPricing(doctorA, visit1)
    const ok = p.calculated_total_paise === 40000 && p.final_amount_paise === 40000 && p.discount_paise === 0 && p.final_amount_set === false
    report('untouched final_amount tracks total upward after a procedure is added (no fabricated discount)', ok, JSON.stringify(p))
  }

  const proc2 = await makeProcedure(doctorA, 'Billing test procedure 2', 6000)
  await addProcedureToVisit(doctorA, visit1, proc2, 6000)
  {
    const p = await readPricing(doctorA, visit1)
    const ok = p.calculated_total_paise === 46000 && p.final_amount_paise === 46000 && p.final_amount_set === false
    report('untouched final_amount keeps tracking a second procedure add', ok, JSON.stringify(p))
  }

  {
    const before = await readPricing(doctorA, visit1)
    const { error } = await doctorA.from('visit_pricing').update({ final_amount_paise: 30000 }).eq('visit_id', visit1)
    if (error) throw new Error(`doctor setting final_amount failed: ${error.message}`)
    const after = await readPricing(doctorA, visit1)
    const ok = after.final_amount_set === true && after.discount_paise === 16000 && after.revision_number === before.revision_number + 1
    report('doctor setting final_amount flips final_amount_set true', ok, JSON.stringify(after))
  }

  const proc3 = await makeProcedure(doctorA, 'Billing test procedure 3', 4000)
  await addProcedureToVisit(doctorA, visit1, proc3, 4000)
  {
    const p = await readPricing(doctorA, visit1)
    const ok = p.calculated_total_paise === 50000 && p.final_amount_paise === 30000 && p.discount_paise === 20000
    report('once set, final_amount holds steady on a total increase (no auto-track after being set)', ok, JSON.stringify(p))
  }

  {
    const { error } = await doctorA.from('visit_procedures').delete().eq('procedure_id', proc3)
    if (error) throw new Error(`removing procedure failed: ${error.message}`)
    const { error: error2 } = await doctorA.from('visit_procedures').delete().eq('procedure_id', proc2)
    if (error2) throw new Error(`removing procedure failed: ${error2.message}`)
    const p = await readPricing(doctorA, visit1)
    // total is back to 40000 (25000 + proc1's 15000), below the set final_amount of 30000 -- no clamp needed yet.
    // Remove proc1 too, dropping total to 25000, which IS below final_amount=30000 and must clamp.
    const { error: error3 } = await doctorA.from('visit_procedures').delete().eq('procedure_id', proc1)
    if (error3) throw new Error(`removing procedure failed: ${error3.message}`)
    const after = await readPricing(doctorA, visit1)
    const ok = after.calculated_total_paise === 25000 && after.final_amount_paise === 25000 && after.discount_paise === 0
    report('a total decrease below the set final_amount still clamps it down to match', ok, `midway ${JSON.stringify(p)}, after ${JSON.stringify(after)}`)
  }

  // ================================================================
  // Section 2 -- get_visit_billing_detail is gated on the visit's stage,
  // not just the caller's role: reception only sees it once the visit has
  // actually reached her desk.
  // ================================================================
  const visit2 = await makeVisit(doctorA, 'billing detail/confirm test fixture')
  console.log(`fixture visit 2 (confirm/detail): ${visit2}`)
  const proc2a = await makeProcedure(doctorA, 'Billing detail procedure', 5000)
  await addProcedureToVisit(doctorA, visit2, proc2a, 5000)
  const med2a = await makeMedicine(doctorA, 'Billing detail medicine', 2000)
  await prescribeToVisit(doctorA, visit2, med2a)
  // visit2 total: 25000 + 5000 + 2000 = 32000

  {
    const { data, error } = await receptionA.rpc('get_visit_billing_detail', { p_visit_id: visit2 })
    const ok = !error && Array.isArray(data) && data.length === 0
    report('reception gets nothing from get_visit_billing_detail before the visit reaches reception (stage=waiting)', ok, error ? error.message : JSON.stringify(data))
  }
  {
    const { data, error } = await doctorA.rpc('get_visit_billing_detail', { p_visit_id: visit2 })
    const kinds = (data ?? []).map((r) => r.kind).sort()
    const ok = !error && kinds.join(',') === 'consultation,medicine,procedure'
    report('doctor gets full billing detail regardless of stage', ok, error ? error.message : JSON.stringify(data))
  }

  {
    const { error } = await doctorA.from('visits').update({ stage: 'packing' }).eq('id', visit2)
    if (error) throw new Error(`moving visit2 to packing failed: ${error.message}`)
    const { data, error: rpcErr } = await receptionA.rpc('confirm_bill', { p_visit_id: visit2, p_payment_method: 'cash' })
    report('confirm_bill refuses a visit still at packing (not opened at reception yet)', !!rpcErr && !data, rpcErr?.message)
  }

  {
    const { error } = await doctorA.from('visits').update({ stage: 'ready_at_reception' }).eq('id', visit2)
    if (error) throw new Error(`moving visit2 to ready_at_reception failed: ${error.message}`)
  }
  {
    const { data, error } = await receptionA.rpc('get_visit_billing_detail', { p_visit_id: visit2 })
    const kinds = (data ?? []).map((r) => r.kind).sort()
    const ok = !error && kinds.join(',') === 'consultation,medicine,procedure'
    report('reception gets the full billing detail once the visit is ready_at_reception', ok, error ? error.message : JSON.stringify(data))
  }
  // confirm_bill's own "waiting for the doctor" guard (final_amount_set is
  // false) is no longer reachable from here to test: reaching packing above
  // (via 20260906160000_ensure_final_amount_set_on_packing.sql) already
  // guarantees final_amount_set is true by the time a visit reaches
  // ready_at_reception -- proved directly, including confirm_bill
  // succeeding on such a visit, in packing-final-amount-test.mjs. The guard
  // itself is left in confirm_bill as defense in depth, not deleted; there's
  // just no longer a client-reachable path left to exercise it against.

  // ================================================================
  // Section 3 -- confirm_bill: the atomic snapshot + close + idempotency.
  // ================================================================
  let bill2Id
  {
    const { error } = await doctorA.from('visit_pricing').update({ final_amount_paise: 30000 }).eq('visit_id', visit2)
    if (error) throw new Error(`doctor setting final_amount on visit2 failed: ${error.message}`)
    const { data, error: rpcErr } = await receptionA.rpc('confirm_bill', { p_visit_id: visit2, p_payment_method: 'cash' })
    bill2Id = data
    report('confirm_bill succeeds once final_amount is set, returning a bill id', !rpcErr && !!bill2Id, rpcErr?.message)
  }
  {
    const { data: bill, error } = await receptionA.from('bills').select('final_amount_paise, pricing_revision_at_confirm, payment_method, needs_reconciliation').eq('id', bill2Id).single()
    const ok = !error && bill.final_amount_paise === 30000 && bill.payment_method === 'cash' && bill.needs_reconciliation === false
    report('the bill snapshots final_amount and payment_method, and needs_reconciliation is false when the snapshot matches', ok, JSON.stringify(bill))
  }
  {
    const { data: items, error } = await receptionA.from('bill_line_items').select('kind, description, unit_price_paise').eq('bill_id', bill2Id).order('kind')
    const total = (items ?? []).reduce((sum, i) => sum + i.unit_price_paise, 0)
    const ok = !error && items.length === 3 && total === 32000
    report('bill_line_items snapshots consultation + procedure + medicine at the right prices', ok, JSON.stringify(items))
  }
  {
    const { data: visit, error } = await receptionA.from('visits').select('stage, closed_at').eq('id', visit2).single()
    const ok = !error && visit.stage === 'paid' && !!visit.closed_at
    report('confirming payment closes the visit (stage=paid, closed_at set)', ok, JSON.stringify(visit))
  }
  {
    const { data: secondCall, error: rpcErr } = await receptionA.rpc('confirm_bill', { p_visit_id: visit2, p_payment_method: 'upi' })
    const { data: allBills } = await receptionA.from('bills').select('id').eq('visit_id', visit2)
    const ok = !rpcErr && secondCall === bill2Id && (allBills ?? []).length === 1
    report('confirm_bill is idempotent: a repeat call returns the same bill id and creates no second row', ok, `second call returned ${secondCall}, bills for visit: ${(allBills ?? []).length}`)
  }

  // ================================================================
  // Section 4 -- needs_reconciliation is set once, at insert, comparing
  // the snapshot revision against the row's live revision at that instant;
  // never patched afterwards.
  // ================================================================
  const visit3 = await makeVisit(doctorA, 'billing reconciliation test fixture')
  console.log(`fixture visit 3 (reconciliation): ${visit3}`)
  {
    const { error } = await doctorA.from('visit_pricing').update({ final_amount_paise: 10000 }).eq('visit_id', visit3)
    if (error) throw new Error(`doctor setting final_amount on visit3 failed: ${error.message}`)
    const p = await readPricing(doctorA, visit3)
    // p.revision_number is now 1 (bumped by the update above). Insert a
    // bill directly (bypassing confirm_bill) claiming a stale revision of
    // 0, simulating an offline-queued confirm that synced after the
    // doctor's own edit -- exactly the case the trigger exists to catch.
    const { data: bill, error: billErr } = await receptionA
      .from('bills')
      .insert({
        clinic_id: CLINIC_A_ID, visit_id: visit3, final_amount_paise: 10000,
        pricing_revision_at_confirm: 0, payment_method: 'cash', confirmed_by: receptionAUser.user.id,
      })
      .select('needs_reconciliation')
      .single()
    const ok = !billErr && p.revision_number === 1 && bill.needs_reconciliation === true
    report('needs_reconciliation is true at insert when the snapshot revision is already behind', ok, `live revision ${p.revision_number}, ${JSON.stringify(bill)}`)
  }

  console.log('\n== Summary ==')
  const failed = results.filter((r) => !r.pass)
  console.log(`${results.length - failed.length}/${results.length} passed`)
  if (failed.length) for (const f of failed) console.log(`  FAIL - ${f.label}`)
  if (failed.length) process.exitCode = 1
}

main().catch((err) => {
  console.error('billing test errored:', err.message)
  process.exitCode = 1
})
