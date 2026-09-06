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

// Fixture helpers, same shape as phase-f-test.mjs's own (that script
// exercises confirm_bill's snapshot args; this one needs a real
// needs_reconciliation bill to correct, same underlying mechanism).
async function makeVisit(complaint) {
  const stamp = Date.now() + Math.random()
  const { data: patient, error: patientErr } = await doctorA.from('patients').insert({ clinic_id: CLINIC_A_ID, name: `Phase G Fix Test Patient ${stamp}`, age: 40 }).select('id').single()
  if (patientErr) throw new Error(`fixture: creating patient failed: ${patientErr.message}`)
  const { data: visit, error: visitErr } = await doctorA.from('visits').insert({ clinic_id: CLINIC_A_ID, patient_id: patient.id, arrived_at: new Date().toISOString(), complaint }).select('id').single()
  if (visitErr) throw new Error(`fixture: creating visit failed: ${visitErr.message}`)
  return visit.id
}

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

// ============================================================
// Section 2: Critical finding #1 -- the offline money-conflict
// *resolution* half doesn't exist: mismatches are correctly detected and
// flagged, but nothing lets a doctor actually write the correction row.
// Genuinely red before migration 20260907040000_correct_bill.sql:
// correct_bill doesn't exist pre-migration, so the two "should succeed"
// assertions below throw; the role-check assertions pass vacuously for
// the same reason Section 1's did pre-migration.
// ============================================================
{
  const visitId = await makeVisit('phase g fix test: reconciliation resolution')
  await readyForBilling(visitId, 18000)
  const snapshot = await pricingOf(visitId)

  // The doctor revises again after reception's (simulated offline) confirm
  // already saw 18000 -- same setup phase-f-test.mjs's Section 1 uses to
  // produce a genuine needs_reconciliation bill.
  await doctorA.from('visit_pricing').update({ final_amount_paise: 12000 }).eq('visit_id', visitId)
  const live = await pricingOf(visitId)

  const { data: billId, error: confirmErr } = await receptionA.rpc('confirm_bill', {
    p_visit_id: visitId,
    p_payment_method: 'cash',
    p_snapshot_final_amount_paise: snapshot.final_amount_paise,
    p_snapshot_revision_number: snapshot.revision_number,
  })
  if (confirmErr) throw new Error(`fixture: confirm_bill failed: ${confirmErr.message}`)

  // bills_needing_reconciliation keeps bills' own primary key column name
  // (b.* -- unlike unpaid_bills, which explicitly aliases id as bill_id)
  const { data: flaggedBefore, error: flaggedErr } = await doctorA.from('bills_needing_reconciliation').select('id, patient_name, live_final_amount_paise, live_revision_number').eq('id', billId).maybeSingle()
  if (flaggedErr) throw new Error(`fixture check failed: ${flaggedErr.message}`)
  report('the flagged bill appears in bills_needing_reconciliation with patient/live-pricing context', !!flaggedBefore && flaggedBefore.live_final_amount_paise === live.final_amount_paise, JSON.stringify(flaggedBefore))

  const { error: recErr } = await receptionA.rpc('correct_bill', { p_bill_id: billId })
  report('reception cannot correct a bill', !!recErr, recErr?.message)

  const { data: newBillId, error: correctErr } = await doctorA.rpc('correct_bill', { p_bill_id: billId })
  report('doctor can correct the flagged bill', !correctErr, correctErr?.message)

  const { data: correction } = await doctorA.from('bills').select('final_amount_paise, pricing_revision_at_confirm, corrects_bill_id').eq('id', newBillId).single()
  report('the correction bill is at the current (12000), not the stale (18000), amount', correction?.final_amount_paise === 12000, JSON.stringify(correction))
  report('the correction bill carries the live revision_number', correction?.pricing_revision_at_confirm === live.revision_number, JSON.stringify(correction))
  report('the correction bill references the original', correction?.corrects_bill_id === billId, JSON.stringify(correction))

  const { data: flaggedAfter, error: flaggedAfterErr } = await doctorA.from('bills_needing_reconciliation').select('id').eq('id', billId).maybeSingle()
  if (flaggedAfterErr) throw new Error(`fixture check failed: ${flaggedAfterErr.message}`)
  report('the original bill no longer appears in bills_needing_reconciliation once corrected', !flaggedAfter, JSON.stringify(flaggedAfter))

  const { error: doubleCorrectErr } = await doctorA.rpc('correct_bill', { p_bill_id: billId })
  report('correcting an already-corrected bill is rejected', !!doubleCorrectErr, doubleCorrectErr?.message)
}

// ============================================================
// Section 3: High finding -- a visit can silently vanish from
// Reception's own billing queue once it crosses midnight still unbilled.
// TokenList.tsx's query used .gte('arrived_at', startOfToday()) with no
// exception for a visit that hasn't been paid yet. Established first
// (docs/STATUS.md): there is no end-of-day/expiry concept anywhere in
// this app for an open visit -- nothing else ever says "yesterday's
// unbilled visit stops being billable" -- so this is a query-scope bug,
// not a missing product state. The fix keeps the existing "today" scope
// for anything already paid (no reason to keep flooding the worklist
// with settled history) but adds an escape hatch for anything not yet
// paid, regardless of arrival date -- mirroring the doctor's own queue,
// which never date-scopes at all.
//
// This section runs both the OLD and the FIXED query shape directly
// (no migration or component needed to demonstrate the difference) --
// genuinely red for the OLD shape (confirms the bug is real), genuinely
// green for the FIXED shape, both asserted here before touching
// TokenList.tsx itself.
// ============================================================
{
  const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() // safely into "yesterday" regardless of timezone

  const staleUnbilledId = await makeVisit('phase g fix test: stale unbilled visit')
  await doctorA.from('visits').update({ arrived_at: yesterday }).eq('id', staleUnbilledId)
  await readyForBilling(staleUnbilledId, 15000) // stage: ready_at_reception, never paid

  const stalePaidId = await makeVisit('phase g fix test: stale already-paid visit')
  await doctorA.from('visits').update({ arrived_at: yesterday }).eq('id', stalePaidId)
  await readyForBilling(stalePaidId, 15000)
  const paidSnapshot = await pricingOf(stalePaidId)
  await receptionA.rpc('confirm_bill', {
    p_visit_id: stalePaidId,
    p_payment_method: 'cash',
    p_snapshot_final_amount_paise: paidSnapshot.final_amount_paise,
    p_snapshot_revision_number: paidSnapshot.revision_number,
  })

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { data: oldQuery } = await receptionA.from('visits').select('id').eq('clinic_id', CLINIC_A_ID).gte('arrived_at', todayStart.toISOString())
  const oldIds = new Set((oldQuery ?? []).map((v) => v.id))
  report("the current query genuinely misses the stale unbilled visit (confirms the bug's real)", !oldIds.has(staleUnbilledId), `oldQuery matched ${oldIds.size} rows`)

  const { data: fixedQuery, error: fixedErr } = await receptionA
    .from('visits')
    .select('id, stage')
    .eq('clinic_id', CLINIC_A_ID)
    .or(`arrived_at.gte.${todayStart.toISOString()},stage.neq.paid`)
  if (fixedErr) throw new Error(`fixed query failed: ${fixedErr.message}`)
  const fixedIds = new Map((fixedQuery ?? []).map((v) => [v.id, v.stage]))
  report('the fixed query surfaces the stale UNBILLED visit', fixedIds.get(staleUnbilledId) === 'ready_at_reception', JSON.stringify(fixedIds.get(staleUnbilledId)))
  report('the fixed query still excludes the stale PAID visit (no worklist bloat from settled history)', !fixedIds.has(stalePaidId), JSON.stringify(fixedIds.has(stalePaidId)))
}

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
