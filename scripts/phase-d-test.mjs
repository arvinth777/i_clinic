// TDD for Phase D (docs/build-plan.md): documents, long-term register,
// follow-up dates, pharma rep check-in. Same convention as every other
// script: plain, against live staging, signed in as the real roles, no
// framework.
//
// Run before the migration exists, everything below is expected to
// throw/miss -- that's red. Run again after the migration is applied,
// everything should pass.
//
// Run from the project root: node scripts/phase-d-test.mjs

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

async function makePatient(name) {
  const { data, error } = await doctorA.from('patients').insert({ clinic_id: CLINIC_A_ID, name, age: 45 }).select('id').single()
  if (error) throw new Error(`fixture: creating patient failed: ${error.message}`)
  return data.id
}

async function makeVisit(patientId, complaint, arrivedAt) {
  const { data, error } = await doctorA
    .from('visits')
    .insert({ clinic_id: CLINIC_A_ID, patient_id: patientId, arrived_at: arrivedAt ?? new Date().toISOString(), complaint })
    .select('id')
    .single()
  if (error) throw new Error(`fixture: creating visit failed: ${error.message}`)
  return data.id
}

const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)
const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)
const adminOnly = await signIn('admin.only@staging.test', userEnv.TEST_ADMIN_ONLY_PASSWORD)
const doctorAId = (await doctorA.auth.getUser()).data.user.id
const receptionAId = (await receptionA.auth.getUser()).data.user.id
console.log('signed in as doctor.a, reception.a, admin.only\n')

// ================================================================
// Section 1 -- clinic_documents: doctor-only, shape enforced
// ================================================================
{
  const patientId = await makePatient(`Doc Test Patient ${Date.now()}`)
  const visitId = await makeVisit(patientId, 'phase d doc test')

  const { data: cert, error: certErr } = await doctorA
    .from('clinic_documents')
    .insert({ clinic_id: CLINIC_A_ID, visit_id: visitId, document_type: 'certificate', purpose: 'fit to travel', issued_by: doctorAId })
    .select('id')
    .single()
  report('doctor can issue a certificate', !certErr && !!cert?.id, certErr?.message)

  const { error: sickErr } = await doctorA
    .from('clinic_documents')
    .insert({ clinic_id: CLINIC_A_ID, visit_id: visitId, document_type: 'sick_leave', rest_from: '2026-09-10', rest_to: '2026-09-12', reason: 'viral fever', issued_by: doctorAId })
  report('doctor can issue a sick-leave note', !sickErr, sickErr?.message)

  const { error: backwardsErr } = await doctorA
    .from('clinic_documents')
    .insert({ clinic_id: CLINIC_A_ID, visit_id: visitId, document_type: 'sick_leave', rest_from: '2026-09-12', rest_to: '2026-09-10', reason: 'bad dates', issued_by: doctorAId })
  report('a sick-leave note with rest_to before rest_from is rejected', !!backwardsErr, backwardsErr?.message)

  const { error: emptyCertErr } = await doctorA
    .from('clinic_documents')
    .insert({ clinic_id: CLINIC_A_ID, visit_id: visitId, document_type: 'certificate', issued_by: doctorAId })
  report('a certificate with no purpose is rejected', !!emptyCertErr, emptyCertErr?.message)

  const { error: refErr } = await doctorA
    .from('clinic_documents')
    .insert({ clinic_id: CLINIC_A_ID, visit_id: visitId, document_type: 'referral', referred_to: 'Dr. Rao, Cardiology', reason: 'chest pain workup', case_summary: 'chronic pain patient, new chest complaint', issued_by: doctorAId })
  report('doctor can issue a referral letter', !refErr, refErr?.message)

  const { error: recInsertErr } = await receptionA
    .from('clinic_documents')
    .insert({ clinic_id: CLINIC_A_ID, visit_id: visitId, document_type: 'certificate', purpose: 'hijacked', issued_by: receptionAId })
  report('reception cannot issue a document', !!recInsertErr, recInsertErr?.message)

  const { error: adminInsertErr } = await adminOnly
    .from('clinic_documents')
    .insert({ clinic_id: CLINIC_A_ID, visit_id: visitId, document_type: 'certificate', purpose: 'hijacked', issued_by: receptionAId })
  report('admin cannot issue a document', !!adminInsertErr, adminInsertErr?.message)

  const { data: docSeenByDoctor } = await doctorA.from('clinic_documents').select('id').eq('visit_id', visitId)
  report('doctor can read documents on the visit', (docSeenByDoctor ?? []).length >= 3, JSON.stringify(docSeenByDoctor))

  const { data: docSeenByReception } = await receptionA.from('clinic_documents').select('id').eq('visit_id', visitId)
  report('reception reads no documents (clinical content, doctor-only)', (docSeenByReception ?? []).length === 0, JSON.stringify(docSeenByReception))

  const { data: docSeenByAdmin } = await adminOnly.from('clinic_documents').select('id').eq('visit_id', visitId)
  report('admin reads no documents (no patient-data exception)', (docSeenByAdmin ?? []).length === 0, JSON.stringify(docSeenByAdmin))
}

// ================================================================
// Section 2 -- long-term register: doctor-only flag, trigger closes the
// blanket-patients_update gap, automatic reset on a new visit, register
// ordering
// ================================================================
{
  const stamp = Date.now()
  const withHistoryId = await makePatient(`LT History Patient ${stamp}`)
  await makeVisit(withHistoryId, 'phase d lt test', new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString())

  const noHistoryId = await makePatient(`LT No-History Patient ${stamp}`)

  const { error: recRpcErr } = await receptionA.rpc('set_patient_long_term', { p_patient_id: withHistoryId, p_is_long_term: true, p_review_interval_days: 30 })
  report('reception cannot flag a patient long-term via the RPC', !!recRpcErr, recRpcErr?.message)

  const { error: recDirectErr } = await receptionA.from('patients').update({ is_long_term: true, long_term_review_interval_days: 30 }).eq('id', withHistoryId)
  report('reception cannot flag a patient long-term via a direct update either (trigger closes the RPC-only gap)', !!recDirectErr, recDirectErr?.message)

  const { error: flagErr } = await doctorA.rpc('set_patient_long_term', { p_patient_id: withHistoryId, p_is_long_term: true, p_review_interval_days: 30 })
  report('doctor can flag a patient long-term', !flagErr, flagErr?.message)

  const { data: withHistory } = await doctorA.from('patients').select('next_review_due').eq('id', withHistoryId).single()
  const expectedDue = new Date(Date.now() - 10 * 24 * 3600 * 1000)
  expectedDue.setDate(expectedDue.getDate() + 30)
  const expectedDueStr = expectedDue.toISOString().slice(0, 10)
  report('next_review_due computed from the last real visit + interval', withHistory?.next_review_due === expectedDueStr, `expected ${expectedDueStr}, got ${withHistory?.next_review_due}`)

  const { error: noHistoryFlagErr } = await doctorA.rpc('set_patient_long_term', { p_patient_id: noHistoryId, p_is_long_term: true, p_review_interval_days: 7 })
  report('doctor can flag a never-visited patient long-term too', !noHistoryFlagErr, noHistoryFlagErr?.message)
  const { data: noHistory } = await doctorA.from('patients').select('next_review_due').eq('id', noHistoryId).single()
  const todayStr = new Date().toISOString().slice(0, 10)
  report('with no prior visit, next_review_due falls back to today + interval', noHistory?.next_review_due >= todayStr, JSON.stringify(noHistory))

  // A brand-new visit must reset next_review_due automatically.
  const resetVisitArrival = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  await makeVisit(withHistoryId, 'phase d lt reset test', resetVisitArrival)
  const { data: afterNewVisit } = await doctorA.from('patients').select('next_review_due').eq('id', withHistoryId).single()
  const expectedResetDue = new Date(resetVisitArrival)
  expectedResetDue.setDate(expectedResetDue.getDate() + 30)
  report('a new visit resets next_review_due automatically', afterNewVisit?.next_review_due === expectedResetDue.toISOString().slice(0, 10), JSON.stringify(afterNewVisit))

  const { data: registerRows } = await doctorA.from('long_term_register').select('patient_id, next_review_due').in('patient_id', [withHistoryId, noHistoryId]).order('next_review_due', { ascending: true })
  report('both flagged patients appear on the register', (registerRows ?? []).length === 2, JSON.stringify(registerRows))
  report('the register orders soonest/most-overdue due date first', (registerRows ?? [])[0]?.patient_id === noHistoryId, JSON.stringify(registerRows))

  const { data: adminRegister } = await adminOnly.from('long_term_register').select('patient_id').in('patient_id', [withHistoryId, noHistoryId])
  report('admin sees nothing on the register (security_invoker inherits patients_select)', (adminRegister ?? []).length === 0, JSON.stringify(adminRegister))

  const { error: unflagErr } = await doctorA.rpc('set_patient_long_term', { p_patient_id: noHistoryId, p_is_long_term: false })
  report('doctor can un-flag a patient', !unflagErr, unflagErr?.message)
  const { data: afterUnflag } = await doctorA.from('long_term_register').select('patient_id').eq('patient_id', noHistoryId)
  report('an un-flagged patient drops off the register', (afterUnflag ?? []).length === 0, JSON.stringify(afterUnflag))

  // An un-flagged patient's is_long_term/interval/next_review_due are
  // all null (patients_long_term_shape's own is_long_term=false branch).
  // reset_long_term_review_on_visit reads is_long_term on every new
  // visit regardless -- confirm it correctly no-ops here rather than
  // trying to write a non-null next_review_due against a patient the
  // constraint now requires it to be null for.
  const { error: checkInAfterUnflagErr } = await doctorA.from('visits').insert({ clinic_id: CLINIC_A_ID, patient_id: noHistoryId, arrived_at: new Date().toISOString(), complaint: 'phase d lt post-unflag check-in' })
  report('checking in an un-flagged patient does not violate patients_long_term_shape', !checkInAfterUnflagErr, checkInAfterUnflagErr?.message)
}

// ================================================================
// Section 3 -- follow-up dates: doctor sets, reception marks done, the
// same trigger-closes-the-blanket-update-gap pattern as the register
// ================================================================
{
  const patientId = await makePatient(`Follow-up Test Patient ${Date.now()}`)
  const visitId = await makeVisit(patientId, 'phase d follow-up test')

  const { error: recRpcErr } = await receptionA.rpc('set_visit_follow_up', { p_visit_id: visitId, p_follow_up_date: '2026-10-01' })
  report('reception cannot set a follow-up date via the RPC', !!recRpcErr, recRpcErr?.message)

  const { error: recDirectErr } = await receptionA.from('visits').update({ follow_up_date: '2026-10-01' }).eq('id', visitId)
  report('reception cannot set a follow-up date via a direct update either', !!recDirectErr, recDirectErr?.message)

  const today = new Date().toISOString().slice(0, 10)
  const { error: setErr } = await doctorA.rpc('set_visit_follow_up', { p_visit_id: visitId, p_follow_up_date: today })
  report('doctor can set a follow-up date', !setErr, setErr?.message)

  const { error: doctorDoneErr } = await doctorA.rpc('mark_follow_up_done', { p_visit_id: visitId })
  report('doctor cannot mark a follow-up done (reception-only action)', !!doctorDoneErr, doctorDoneErr?.message)

  const { error: doneErr } = await receptionA.rpc('mark_follow_up_done', { p_visit_id: visitId })
  report('reception can mark a follow-up done', !doneErr, doneErr?.message)

  const { data: doneVisit } = await doctorA.from('visits').select('follow_up_done_at').eq('id', visitId).single()
  report('follow_up_done_at is stamped', !!doneVisit?.follow_up_done_at, JSON.stringify(doneVisit))

  // A revised date starts a fresh to-do.
  await doctorA.rpc('set_visit_follow_up', { p_visit_id: visitId, p_follow_up_date: today })
  const { data: revised } = await doctorA.from('visits').select('follow_up_done_at').eq('id', visitId).single()
  report('setting a new follow-up date clears any earlier done mark', revised?.follow_up_done_at === null, JSON.stringify(revised))

  // Reception's "due today" to-do query: due today or overdue, not done.
  const { data: todos } = await receptionA.from('visits').select('id').eq('id', visitId).lte('follow_up_date', today).is('follow_up_done_at', null)
  report('the visit surfaces as a reception to-do once due and not done', (todos ?? []).length === 1, JSON.stringify(todos))

  await receptionA.rpc('mark_follow_up_done', { p_visit_id: visitId })
  const { data: todosAfterDone } = await receptionA.from('visits').select('id').eq('id', visitId).lte('follow_up_date', today).is('follow_up_done_at', null)
  report('a done follow-up drops off the to-do query', (todosAfterDone ?? []).length === 0, JSON.stringify(todosAfterDone))
}

// ================================================================
// Section 4 -- pharma rep check-in: reception checks in, doctor marks
// done, admin excluded; plus the deferred seed case's premise
// ================================================================
{
  const { data: rep, error: checkInErr } = await receptionA
    .from('pharma_rep_checkins')
    .insert({ clinic_id: CLINIC_A_ID, rep_name: `Test Rep ${Date.now()}`, company: 'Test Pharma', checked_in_by: receptionAId })
    .select('id')
    .single()
  report('reception can check in a pharma rep', !checkInErr && !!rep?.id, checkInErr?.message)

  const { error: doctorCheckInErr } = await doctorA
    .from('pharma_rep_checkins')
    .insert({ clinic_id: CLINIC_A_ID, rep_name: 'Doctor-checked-in rep', company: 'Should not work', checked_in_by: doctorAId })
  report('doctor cannot check in a rep (reception-only)', !!doctorCheckInErr, doctorCheckInErr?.message)

  // RLS silently affects zero rows on a USING-clause mismatch rather
  // than erroring -- .select() is what makes that visible.
  const { data: recDoneRows } = await receptionA.from('pharma_rep_checkins').update({ done_at: new Date().toISOString() }).eq('id', rep.id).select('id')
  report('reception cannot mark a rep done (lives on the doctor queue)', (recDoneRows ?? []).length === 0, JSON.stringify(recDoneRows))

  const { error: doctorDoneErr } = await doctorA.from('pharma_rep_checkins').update({ done_at: new Date().toISOString() }).eq('id', rep.id)
  report('doctor can mark a rep done', !doctorDoneErr, doctorDoneErr?.message)

  const { data: adminSeesReps } = await adminOnly.from('pharma_rep_checkins').select('id').eq('id', rep.id)
  report('admin sees no rep check-ins', (adminSeesReps ?? []).length === 0, JSON.stringify(adminSeesReps))

  // Deferred seed case premise (migration 20260906230000): the rep was
  // seeded checked-in two hours before the patient's visit arrived.
  // Confirming the premise here is what makes the sort bug real -- a
  // naive single-column arrived_at sort would rank this rep first. The
  // actual rendered order (patients always before reps, regardless of
  // arrival time) is a UI concern verified separately via a live browser
  // check, not re-derived here.
  const { data: seedRep } = await doctorA.from('pharma_rep_checkins').select('arrived_at').eq('rep_name', 'Seed Test Rep').eq('company', 'Seed Pharma Co').single()
  const { data: seedPatient } = await doctorA.from('patients').select('id').eq('name', 'Seed Rep Sort Test Patient').single()
  const { data: seedVisit } = await doctorA.from('visits').select('arrived_at').eq('patient_id', seedPatient?.id).eq('complaint', 'seed: rep sort test').single()
  report(
    'deferred seed case: the rep checked in before the patient arrived (the case a naive arrived_at sort gets backwards)',
    !!seedRep && !!seedVisit && new Date(seedRep.arrived_at) < new Date(seedVisit.arrived_at),
    JSON.stringify({ seedRep, seedVisit }),
  )
}

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
