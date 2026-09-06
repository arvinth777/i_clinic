// TDD for Phase E (docs/build-plan.md): reports -- daily, monthly, GST.
// The whole phase turns on one thing: admin sees financial aggregates
// with zero row-level access to patients/visits/bills/prescriptions/
// patient_comments. Every assertion below tests both halves explicitly
// -- a passing report with a leaking table is a fail, per the brief.
//
// Staging is shared, ever-growing data from every earlier phase's own
// tests, so aggregate assertions are all delta-based: read the report
// before creating a fixture, again after, and assert the difference
// matches exactly what the fixture should contribute -- never an
// absolute total.
//
// Run before the migration exists, the four report RPCs are expected to
// throw -- that's red. Run again after the migration is applied,
// everything should pass.
//
// Run from the project root: node scripts/phase-e-test.mjs

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
  const { data: patient, error: patientErr } = await doctorA.from('patients').insert({ clinic_id: CLINIC_A_ID, name: `Report Test Patient ${stamp}`, age: 30 }).select('id').single()
  if (patientErr) throw new Error(`fixture: creating patient failed: ${patientErr.message}`)
  const { data: visit, error: visitErr } = await doctorA.from('visits').insert({ clinic_id: CLINIC_A_ID, patient_id: patient.id, arrived_at: new Date().toISOString(), complaint }).select('id').single()
  if (visitErr) throw new Error(`fixture: creating visit failed: ${visitErr.message}`)
  return visit.id
}

async function billAs(visitId, paymentMethod, finalAmountPaise) {
  await doctorA.from('visits').update({ stage: 'with_doctor' }).eq('id', visitId)
  if (finalAmountPaise != null) {
    await doctorA.from('visit_pricing').update({ final_amount_paise: finalAmountPaise }).eq('visit_id', visitId)
  }
  await doctorA.from('visits').update({ stage: 'packing' }).eq('id', visitId)
  await receptionA.from('visits').update({ stage: 'ready_at_reception' }).eq('id', visitId)
  const { data: billId, error } = await receptionA.rpc('confirm_bill', { p_visit_id: visitId, p_payment_method: paymentMethod })
  if (error) throw new Error(`confirm_bill failed: ${error.message}`)
  return billId
}

const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)
const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)
const adminOnly = await signIn('admin.only@staging.test', userEnv.TEST_ADMIN_ONLY_PASSWORD)
const doctorB = await signIn('doctor.b@staging.test', userEnv.TEST_DOCTOR_B_PASSWORD)
console.log('signed in as doctor.a, reception.a, admin.only, doctor.b\n')

// ================================================================
// Section 1 -- role boundary: only admin/doctor can call the report
// RPCs; reception cannot; admin's direct row reads still return nothing
// (the "test both halves" requirement -- checked first, before anything
// else, so a leaking table can't hide behind a passing report)
// ================================================================
{
  const { data: adminPatients } = await adminOnly.from('patients').select('id').limit(1)
  report('admin direct read on patients returns nothing', (adminPatients ?? []).length === 0, JSON.stringify(adminPatients))

  const { data: adminVisits } = await adminOnly.from('visits').select('id').limit(1)
  report('admin direct read on visits returns nothing', (adminVisits ?? []).length === 0, JSON.stringify(adminVisits))

  const { data: adminBills } = await adminOnly.from('bills').select('id').limit(1)
  report('admin direct read on bills returns nothing', (adminBills ?? []).length === 0, JSON.stringify(adminBills))

  const { data: adminPrescriptions } = await adminOnly.from('prescriptions').select('id').limit(1)
  report('admin direct read on prescriptions returns nothing', (adminPrescriptions ?? []).length === 0, JSON.stringify(adminPrescriptions))

  const { data: adminComments } = await adminOnly.from('patient_comments').select('id').limit(1)
  report('admin direct read on patient_comments returns nothing', (adminComments ?? []).length === 0, JSON.stringify(adminComments))

  const { error: recDailyErr } = await receptionA.rpc('get_daily_report', {})
  report('reception cannot call get_daily_report', !!recDailyErr, recDailyErr?.message)

  const { error: recMonthlyErr } = await receptionA.rpc('get_monthly_report', {})
  report('reception cannot call get_monthly_report', !!recMonthlyErr, recMonthlyErr?.message)

  const { error: recGstErr } = await receptionA.rpc('get_gst_report', { p_start_date: '2026-01-01', p_end_date: '2026-01-31' })
  report('reception cannot call get_gst_report', !!recGstErr, recGstErr?.message)

  const { error: recStockErr } = await receptionA.rpc('get_stock_warnings_report', {})
  report('reception cannot call get_stock_warnings_report', !!recStockErr, recStockErr?.message)
}

// ================================================================
// Section 2 -- get_daily_report: collections (cash/upi billed today +
// any pay_later bill settled today), patient count, discount, and the
// needs_reconciliation count, all as deltas around known fixtures
// ================================================================
{
  const { data: before } = await adminOnly.rpc('get_daily_report', {})
  const b = before[0]

  // Cross-clinic isolation: v_clinic_id is derived from the caller's own
  // user_roles row, not passed in -- so clinic A's billing activity below
  // must be invisible to clinic B's own report. Captured before/after the
  // exact same fixtures clinic A's own delta assertions below are checked
  // against.
  const { data: beforeB } = await doctorB.rpc('get_daily_report', {})
  const bB = beforeB[0]

  // Cash visit billed today with a real discount: calculated total is
  // the flat consultation fee (25000), final amount set to 18000.
  const cashVisit = await makeVisit('report test cash visit')
  await billAs(cashVisit, 'cash', 18000)

  // Pay-later visit billed today, then settled today -- contributes to
  // collections via the settlement, not the same-day bill confirm.
  const payLaterVisit = await makeVisit('report test pay-later settled today')
  const payLaterBillId = await billAs(payLaterVisit, 'pay_later', null)
  await receptionA.rpc('settle_bill', { p_bill_id: payLaterBillId, p_payment_method: 'cash' })

  // A second pay-later visit billed today but left unsettled -- must
  // NOT contribute to today's collections at all.
  const unsettledVisit = await makeVisit('report test pay-later unsettled')
  await billAs(unsettledVisit, 'pay_later', null)

  const { data: after } = await adminOnly.rpc('get_daily_report', {})
  const a = after[0]

  report(
    'collections delta = cash bill (18000) + settled pay-later bill (25000), unsettled pay-later excluded',
    BigInt(a.collections_paise) - BigInt(b.collections_paise) === 43000n,
    `before ${b.collections_paise}, after ${a.collections_paise}`,
  )
  report('patient_count delta = 3 new patients seen today', a.patient_count - b.patient_count === 3, `before ${b.patient_count}, after ${a.patient_count}`)
  report(
    'discount delta = 7000 (cash visit only: 25000 - 18000; the two pay_later visits kept full price)',
    BigInt(a.discount_paise) - BigInt(b.discount_paise) === 7000n,
    `before ${b.discount_paise}, after ${a.discount_paise}`,
  )

  const { data: afterB } = await doctorB.rpc('get_daily_report', {})
  const aB = afterB[0]
  report(
    "clinic A's bills (43000 collections, 7000 discount, 3 patients) move clinic B's own report by exactly zero",
    BigInt(aB.collections_paise) === BigInt(bB.collections_paise)
      && BigInt(aB.discount_paise) === BigInt(bB.discount_paise)
      && aB.patient_count === bB.patient_count,
    `before ${JSON.stringify(bB)}, after ${JSON.stringify(aB)}`,
  )

  // Construct a live needs_reconciliation case: revise pricing on an
  // already-confirmed bill's visit, bumping revision_number past what
  // that bill snapshotted at confirm time -- the same "a contradicting
  // revision arrives after the bill synced" race bills_needing_
  // reconciliation already exists to catch.
  await doctorA.from('visit_pricing').update({ final_amount_paise: 10000 }).eq('visit_id', cashVisit)

  const { data: afterRevision } = await adminOnly.rpc('get_daily_report', {})
  const ar = afterRevision[0]
  report(
    'needs_reconciliation_count increases by 1 once a confirmed bill\'s pricing is revised afterward',
    ar.needs_reconciliation_count - b.needs_reconciliation_count === 1,
    `before ${b.needs_reconciliation_count}, after ${ar.needs_reconciliation_count}`,
  )

  const { data: doctorSees } = await doctorA.rpc('get_daily_report', {})
  report('doctor can also call get_daily_report (PRD: sees his own monthly/daily discount total)', !!doctorSees, JSON.stringify(doctorSees))
}

// ================================================================
// Section 3 -- get_stock_warnings_report: no patient data at all, so
// row-level medicine output is fine; the pre-existing negative-stock
// seed fixture must always appear
// ================================================================
{
  const { data: warnings, error } = await adminOnly.rpc('get_stock_warnings_report', {})
  report('get_stock_warnings_report succeeds for admin', !error, error?.message)
  const seedRow = (warnings ?? []).find((w) => w.medicine_name === 'Seed Negative Stock Medicine')
  report('the seeded negative-stock medicine appears as a warning', !!seedRow && seedRow.total_quantity < 0, JSON.stringify(seedRow))
}

// ================================================================
// Section 4 -- get_monthly_report: row count, ordering, current month
// included
// ================================================================
{
  const { data: months, error } = await adminOnly.rpc('get_monthly_report', { p_months: 3 })
  report('get_monthly_report returns exactly p_months rows', !error && months.length === 3, error?.message ?? JSON.stringify(months))
  const sorted = [...months].sort((x, y) => (x.month_start < y.month_start ? -1 : 1))
  report('rows are ordered oldest to newest', JSON.stringify(months) === JSON.stringify(sorted), JSON.stringify(months))
  const thisMonthStart = new Date()
  thisMonthStart.setDate(1)
  const thisMonthStr = thisMonthStart.toISOString().slice(0, 10)
  report('the most recent row is the current month', months[months.length - 1]?.month_start === thisMonthStr, JSON.stringify(months))

  const { error: rangeErr } = await adminOnly.rpc('get_monthly_report', { p_months: 100 })
  report('p_months outside 1..36 is rejected', !!rangeErr, rangeErr?.message)
}

// ================================================================
// Section 5 -- get_gst_report: date-range aggregate, no patient
// identifiers, invalid range rejected
// ================================================================
{
  const today = new Date().toISOString().slice(0, 10)
  const { data: gst, error } = await adminOnly.rpc('get_gst_report', { p_start_date: today, p_end_date: today })
  report('get_gst_report succeeds for a same-day range', !error && gst.length === 1, error?.message ?? JSON.stringify(gst))
  const row = gst?.[0] ?? {}
  report('the GST row exposes only aggregate columns, no identifiers', Object.keys(row).sort().join(',') === 'bill_count,collections_paise,discount_paise', JSON.stringify(row))

  const { error: backwardsErr } = await adminOnly.rpc('get_gst_report', { p_start_date: today, p_end_date: '2020-01-01' })
  report('an end date before the start date is rejected', !!backwardsErr, backwardsErr?.message)
}

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
