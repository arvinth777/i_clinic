// Public payment/pricing boundaries from the audit; synthetic staging only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

function env(path) {
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).map((line) => {
    const equal = line.indexOf('=')
    return [line.slice(0, equal).trim(), line.slice(equal + 1).trim()]
  }))
}
const app = env('.env.local')
const passwords = env('.env.test-users.local')
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname, 'cofnrcgsolluyhghutah.supabase.co', 'tests must target staging')
const clinicId = '23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
const clients = []
async function signIn(role, password, clinic = 'a') {
  const client = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { transport: ws } })
  const email = role === 'admin.only' ? 'admin.only@staging.test' : `${role}.${clinic}@staging.test`
  const { error } = await client.auth.signInWithPassword({ email, password })
  assert.ifError(error)
  clients.push(client)
  return client
}
function value(result) {
  assert.ifError(result.error)
  return result.data
}
let doctor, reception
async function visit(name = `Audit synthetic ${crypto.randomUUID()}`, arrivedAt = new Date().toISOString()) {
  const patient = value(await doctor.from('patients').insert({ clinic_id: clinicId, name, age: 40 }).select('id').single())
  return value(await doctor.from('visits').insert({ clinic_id: clinicId, patient_id: patient.id, arrived_at: arrivedAt, complaint: 'Synthetic audit fixture' }).select('id').single()).id
}
async function ready(id, amount = 22000) {
  value(await doctor.from('visit_pricing').update({ final_amount_paise: amount }).eq('visit_id', id))
  value(await doctor.from('visits').update({ stage: 'packing' }).eq('id', id))
  value(await reception.from('visits').update({ stage: 'ready_at_reception' }).eq('id', id))
  return value(await reception.from('visit_pricing').select('final_amount_paise, revision_number').eq('visit_id', id).single())
}
function confirm(id, snapshot, amount = snapshot.final_amount_paise) {
  return reception.rpc('confirm_bill', { p_visit_id: id, p_payment_method: 'cash', p_snapshot_final_amount_paise: amount, p_snapshot_revision_number: snapshot.revision_number })
}
try {
  doctor = await signIn('doctor', passwords.TEST_DOCTOR_A_PASSWORD)
  reception = await signIn('reception', passwords.TEST_RECEPTION_A_PASSWORD)
  const id = await visit()
  const approved = await ready(id)
  const forged = await confirm(id, approved, 100)
  assert.ok(forged.error, 'reception cannot replace an approved amount while claiming the approved revision')
  console.log('PASS: forged amount rejected')
  value(await doctor.from('visit_pricing').update({ final_amount_paise: 18000 }).eq('visit_id', id))
  const billId = value(await confirm(id, approved))
  const bill = value(await reception.from('bills').select('final_amount_paise, needs_reconciliation').eq('id', billId).single())
  assert.equal(bill.final_amount_paise, 22000, 'legitimate older doctor approval must keep the amount collected offline')
  assert.equal(bill.needs_reconciliation, true, 'older approval must be flagged for doctor reconciliation')
  assert.equal(value(await confirm(id, approved)), billId, 'confirmation must stay idempotent')
  console.log('PASS: approved stale snapshot retained, flagged, and idempotent')
  const user = value(await reception.auth.getUser()).user
  const direct = await reception.from('bills').insert({ clinic_id: clinicId, visit_id: await visit(), final_amount_paise: 100, pricing_revision_at_confirm: 0, payment_method: 'cash', confirmed_by: user.id })
  assert.ok(direct.error, 'direct bill inserts must not bypass the payment transaction')
  assert.ok((await reception.from('bill_line_items').insert({ clinic_id: clinicId, bill_id: billId, kind: 'consultation', description: 'Synthetic injected line', unit_price_paise: 100 })).error, 'paid bill lines cannot be appended directly')
  assert.ok((await doctor.from('bills').insert({ clinic_id: clinicId, visit_id: id, final_amount_paise: 100, pricing_revision_at_confirm: 0, payment_method: 'cash', confirmed_by: value(await doctor.auth.getUser()).user.id, corrects_bill_id: billId })).error, 'doctor corrections must also use their guarded RPC')
  assert.ok((await reception.rpc('correct_bill', { p_bill_id: billId })).error, 'reception cannot discount by correction')
  const correction = value(await doctor.rpc('correct_bill', { p_bill_id: billId }))
  assert.equal(value(await doctor.from('bills').select('final_amount_paise').eq('id', correction).single()).final_amount_paise, 18000)
  assert.equal(value(await doctor.from('bills').select('final_amount_paise').eq('id', billId).single()).final_amount_paise, 22000, 'original paid bill stays immutable')
  assert.ok((await reception.from('pricing_approvals').insert({ clinic_id: clinicId, visit_id: id, revision_number: 999, final_amount_paise: 100 })).error, 'reception cannot manufacture approval history')
  console.log('PASS: direct bill insert denied')
  const medicine = value(await doctor.from('medicines').insert({ clinic_id: clinicId, name: `Audit medicine ${crypto.randomUUID()}`, price_paise: 100 }).select('id').single())
  const rxVisit = await visit()
  const prescriptionId = crypto.randomUUID()
  const prescriptionArgs = { p_prescription_id: prescriptionId, p_visit_id: rxVisit, p_items: [{ id: crypto.randomUUID(), medicine_id: medicine.id, drug_type: 'Tablet', strength: 'Synthetic strength', dosage_frequency: '1-0-1', before_after_food: 'After food', duration_days: 5, quantity_dispensed: 10, notes: null }] }
  assert.equal(value(await doctor.rpc('save_prescription', prescriptionArgs)), prescriptionId, 'doctor saves a complete prescription atomically')
  assert.equal(value(await doctor.rpc('save_prescription', prescriptionArgs)), prescriptionId, 'replaying the same prescription does not duplicate it')
  assert.ok((await reception.rpc('save_prescription', { ...prescriptionArgs, p_prescription_id: crypto.randomUUID() })).error, 'reception cannot prescribe')
  const invalidId = crypto.randomUUID()
  assert.ok((await doctor.rpc('save_prescription', { ...prescriptionArgs, p_prescription_id: invalidId, p_items: [{ ...prescriptionArgs.p_items[0], id: crypto.randomUUID(), duration_days: 0 }] })).error, 'invalid instructions must fail')
  assert.equal(value(await doctor.from('prescriptions').select('id').eq('id', invalidId)).length, 0, 'invalid instructions cannot leave an empty header')
  const rxApproval = await ready(rxVisit)
  const rxBill = value(await confirm(rxVisit, rxApproval))
  assert.equal(value(await confirm(rxVisit, rxApproval)), rxBill)
  const stock = value(await reception.from('stock_movements').select('quantity_delta').eq('reference_id', prescriptionArgs.p_items[0].id).eq('reason', 'dispensed'))
  assert.deepEqual(stock, [{ quantity_delta: -10 }], 'payment deducts the supplied quantity exactly once')
  const admin = await signIn('admin.only', passwords.TEST_ADMIN_ONLY_PASSWORD)
  // This account has no clinical role even though it administers Clinic A.
  assert.ok((await admin.rpc('save_prescription', { ...prescriptionArgs, p_prescription_id: crypto.randomUUID() })).error)
  assert.equal(value(await admin.from('pricing_approvals').select('visit_id').eq('visit_id', rxVisit)).length, 0)
  const otherDoctor = await signIn('doctor', passwords.TEST_DOCTOR_B_PASSWORD, 'b')
  assert.ok((await otherDoctor.rpc('save_prescription', { ...prescriptionArgs, p_prescription_id: crypto.randomUUID() })).error, 'another clinic cannot prescribe for this visit')
  assert.equal(value(await otherDoctor.from('pricing_approvals').select('visit_id').eq('visit_id', rxVisit)).length, 0)
  const anon = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { transport: ws } })
  assert.ok((await anon.from('pricing_approvals').select('visit_id')).error, 'anonymous callers cannot read approval history')
  assert.ok((await anon.rpc('save_prescription', prescriptionArgs)).error, 'anonymous callers cannot prescribe')
  console.log('PASS: complete prescription save is atomic, replayable, and doctor-only')
  console.log('PASS: paid corrections, stock deduction, approval history, and clinic isolation')
  const queueLabel = crypto.randomUUID().slice(0, 8)
  const later = await visit(`Audit queue later ${queueLabel}`, new Date(Date.now() - 300000).toISOString())
  const earlier = await visit(`Audit queue earlier ${queueLabel}`, new Date(Date.now() - 600000).toISOString())
  const queue = value(await reception.from('visits').select('id, token_number').in('id', [later, earlier]).order('arrived_at').order('id'))
  assert.equal(queue[0].id, earlier)
  assert.ok(queue[0].token_number > queue[1].token_number, 'late-synced earlier arrivals carry later token labels')
  console.log(`PASS: late-sync queue fixture ${queueLabel}; verify earlier precedes later on both screens`)
} finally {
  await Promise.all(clients.map((client) => client.auth.signOut()))
}
