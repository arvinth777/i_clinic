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
  const id = await visit()
  const rxId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  value(await doctor.rpc('save_prescription', { p_prescription_id: rxId, p_visit_id: id, p_items: [{ id: itemId, medicine_id: medicine.id, drug_type: 'Tablet', dosage_frequency: '1-0-0', before_after_food: 'After food', duration_days: 3, quantity_dispensed: 3 }] }))
  const pricing = value(await doctor.from('visit_pricing').select('calculated_total_paise').eq('visit_id', id).single())
  assert.equal(pricing.calculated_total_paise, 28000, '₹250 consultation + three ₹10 tablets = ₹280')
  value(await reception.rpc('set_medicine_unit_price', { p_medicine_id: medicine.id, p_stock_unit: 'tablet', p_price_paise: 2000 }))
  const approved = await ready(id, 28000)
  const billId = value(await confirm(id, approved))
  const lines = value(await reception.from('bill_line_items').select('quantity, unit_price_paise, line_total_paise, stock_unit').eq('bill_id', billId).eq('kind', 'medicine'))
  assert.deepEqual(lines, [{ quantity: 3, unit_price_paise: 1000, line_total_paise: 3000, stock_unit: 'tablet' }], 'bill keeps the prescribed unit price even after catalog edits')
  assert.equal(value(await confirm(id, approved)), billId)
  assert.deepEqual(value(await reception.from('stock_movements').select('quantity_delta').eq('reference_id', itemId).eq('reason', 'dispensed')), [{ quantity_delta: -3 }])
  console.log('PASS: quantity × frozen unit price, immutable receipt, and one stock deduction')
  const saleId = crypto.randomUUID()
  const saleArgs = { p_sale_id: saleId, p_clinic_id: clinicId, p_customer_name: 'Synthetic pharmacy customer', p_items: [{ medicine_id: medicine.id, quantity: 3, unit_price_paise: 2000, stock_unit: 'tablet' }] }
  value(await reception.rpc('save_pharmacy_sale', saleArgs))
  const sale = value(await reception.from('pharmacy_sales').select('customer_name, final_amount_paise, bill_id').eq('id', saleId).single())
  assert.equal(sale.customer_name, 'Synthetic pharmacy customer')
  assert.equal(sale.final_amount_paise, 6000, 'three ₹20 units, no ₹250 consultation fee')
  assert.equal(sale.bill_id, null)
  assert.equal(value(await reception.rpc('save_pharmacy_sale', saleArgs)), saleId)
  console.log('PASS: name-only pharmacy draft at saved prices, without consultation or token')
} finally {
  await Promise.all(clients.map((client) => client.auth.signOut()))
}
