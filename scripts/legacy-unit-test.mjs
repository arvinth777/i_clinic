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
  const visitId = 'c0a17541-7a1f-423e-af1f-4ec6d7481202'
  const medicineId = 'e8cb735c-c16d-40b0-9a6f-428ba9815450'
  const medicine = value(await doctor.from('medicines').select('unit_confirmed_at').eq('id', medicineId).single())
  if (!medicine.unit_confirmed_at) {
    assert.ok((await doctor.from('visit_pricing').update({ final_amount_paise: 0 }).eq('visit_id', visitId)).error, 'legacy unitless prescriptions cannot be approved')
    value(await reception.rpc('set_medicine_unit_price', { p_medicine_id: medicineId, p_stock_unit: 'tablet', p_price_paise: 100 }))
    const pricing = value(await doctor.from('visit_pricing').select('final_amount_set, calculated_total_paise').eq('visit_id', visitId).single())
    assert.equal(pricing.final_amount_set, false, 'first unit confirmation invalidates any earlier approval')
    assert.equal(pricing.calculated_total_paise, 26000)
    assert.equal(value(await doctor.from('pricing_approvals').select('revision_number').eq('visit_id', visitId)).length, 0)
  }
  value(await doctor.from('visit_pricing').update({ final_amount_paise: 26000 }).eq('visit_id', visitId))
  assert.equal(value(await doctor.from('visit_pricing').select('final_amount_set').eq('visit_id', visitId).single()).final_amount_set, true)
  console.log('PASS: legacy unit review requires a fresh doctor approval; confirmed fixture remains usable')
} finally {
  await Promise.all(clients.map(client => client.auth.signOut()))
}
