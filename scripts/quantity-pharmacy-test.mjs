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
  const medicine = value(await doctor.from('medicines').insert({ clinic_id: clinicId, name: `Unit synthetic ${crypto.randomUUID()}`, price_paise: 1000 }).select('id').single())
  value(await reception.rpc('set_medicine_unit_price', { p_medicine_id: medicine.id, p_stock_unit: 'tablet', p_price_paise: 1000 }))
  const catalog = value(await reception.from('medicines').select('stock_unit, price_paise, unit_confirmed_at').eq('id', medicine.id).single())
  assert.equal(catalog.stock_unit, 'tablet')
  assert.equal(catalog.price_paise, 1000)
  assert.ok(catalog.unit_confirmed_at)
  console.log('PASS: reception confirms catalog unit and price')
} finally {
  await Promise.all(clients.map((client) => client.auth.signOut()))
}
