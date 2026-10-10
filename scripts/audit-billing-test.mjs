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
async function signIn(role, password) {
  const client = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { transport: ws } })
  const { error } = await client.auth.signInWithPassword({ email: `${role}.a@staging.test`, password })
  assert.ifError(error)
  clients.push(client)
  return client
}
function value(result) {
  assert.ifError(result.error)
  return result.data
}
let doctor, reception
async function visit() {
  const patient = value(await doctor.from('patients').insert({ clinic_id: clinicId, name: `Audit synthetic ${crypto.randomUUID()}`, age: 40 }).select('id').single())
  return value(await doctor.from('visits').insert({ clinic_id: clinicId, patient_id: patient.id, arrived_at: new Date().toISOString(), complaint: 'Synthetic audit fixture' }).select('id').single()).id
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
  console.log('PASS: direct bill insert denied')
  const medicine = value(await doctor.from('medicines').insert({ clinic_id: clinicId, name: `Audit medicine ${crypto.randomUUID()}`, price_paise: 100 }).select('id').single())
  const rxVisit = await visit()
  const prescriptionId = crypto.randomUUID()
  const prescriptionArgs = { p_prescription_id: prescriptionId, p_visit_id: rxVisit, p_items: [{ id: crypto.randomUUID(), medicine_id: medicine.id, drug_type: 'Tablet', strength: 'Synthetic strength', dosage_frequency: '1-0-1', before_after_food: 'After food', duration_days: 5, quantity_dispensed: 10, notes: null }] }
  assert.equal(value(await doctor.rpc('save_prescription', prescriptionArgs)), prescriptionId, 'doctor saves a complete prescription atomically')
  assert.equal(value(await doctor.rpc('save_prescription', prescriptionArgs)), prescriptionId, 'replaying the same prescription does not duplicate it')
  assert.ok((await reception.rpc('save_prescription', { ...prescriptionArgs, p_prescription_id: crypto.randomUUID() })).error, 'reception cannot prescribe')
  console.log('PASS: complete prescription save is atomic, replayable, and doctor-only')
} finally {
  await Promise.all(clients.map((client) => client.auth.signOut()))
}
