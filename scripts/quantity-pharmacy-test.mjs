import {sendToBilling} from './clinic-workflow-fixture.mjs'
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
  return sendToBilling(doctor,reception,clinicId,id,amount)
}

function confirm(id, snapshot, amount = snapshot.final_amount_paise) {
  return reception.rpc('confirm_bill', { p_visit_id: id, p_payment_method: 'cash', p_snapshot_final_amount_paise: amount, p_snapshot_revision_number: snapshot.revision_number })
}
try {
  doctor = await signIn('doctor', passwords.TEST_DOCTOR_A_PASSWORD)
  reception = await signIn('reception', passwords.TEST_RECEPTION_A_PASSWORD)
  const medicine = value(await doctor.from('medicines').insert({ clinic_id: clinicId, name: `Unit synthetic ${crypto.randomUUID()}`, price_paise: 1000 }).select('id').single())
  value(await reception.rpc('set_medicine_unit_price', { p_medicine_id: medicine.id, p_stock_unit: 'tablet', p_price_paise: 1000 }))
  const counter=value(await reception.from('stock_points').select('id').eq('clinic_id',clinicId).eq('name','Counter').single()).id
  value(await reception.rpc('adjust_stock',{p_clinic_id:clinicId,p_medicine_id:medicine.id,p_stock_point_id:counter,p_quantity_delta:20,p_reason:'Synthetic quantity test stock'}))
  const catalog = value(await reception.from('medicines').select('stock_unit, price_paise, unit_confirmed_at').eq('id', medicine.id).single())
  assert.equal(catalog.stock_unit, 'tablet')
  assert.equal(catalog.price_paise, 1000)
  assert.ok(catalog.unit_confirmed_at)
  console.log('PASS: reception confirms catalog unit and price')
  const unconfirmed = value(await doctor.from('medicines').insert({ clinic_id: clinicId, name: `Unconfirmed synthetic ${crypto.randomUUID()}`, price_paise: 1000 }).select('id').single())
  const blockedVisit = await visit()
  assert.ok((await doctor.rpc('save_prescription', { p_prescription_id: crypto.randomUUID(), p_visit_id: blockedVisit, p_items: [{ id: crypto.randomUUID(), medicine_id: unconfirmed.id, duration_days: 3, quantity_dispensed: 3 }] })).error, 'unconfirmed units cannot enter a new prescription')
  const id = await visit()
  const rxId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  value(await doctor.rpc('save_prescription', { p_prescription_id: rxId, p_visit_id: id, p_items: [{ id: itemId, medicine_id: medicine.id, drug_type: 'Tablet', dosage_frequency: '1-0-0', before_after_food: 'After food', duration_days: 3, quantity_dispensed: 3 }] }))
  const pricing = value(await doctor.from('visit_pricing').select('calculated_total_paise').eq('visit_id', id).single())
  assert.equal(pricing.calculated_total_paise, 28000, '₹250 consultation + three ₹10 tablets = ₹280')
  const approved = await ready(id, 28000)
  value(await reception.rpc('set_medicine_unit_price', { p_medicine_id: medicine.id, p_stock_unit: 'tablet', p_price_paise: 2000 }))
  const billId = value(await confirm(id, approved))
  const lines = value(await reception.from('bill_line_items').select('quantity, unit_price_paise, line_total_paise, stock_unit').eq('bill_id', billId).eq('kind', 'medicine'))
  assert.deepEqual(lines, [{ quantity: 3, unit_price_paise: 1000, line_total_paise: 3000, stock_unit: 'tablet' }], 'bill keeps the approved unit price even after catalog edits')
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
  value(await reception.rpc('set_medicine_unit_price', { p_medicine_id: medicine.id, p_stock_unit: 'tablet', p_price_paise: 2500 }))
  assert.equal(value(await reception.rpc('save_pharmacy_sale', saleArgs)), saleId)
  console.log('PASS: name-only pharmacy draft at saved prices, without consultation or token')
  assert.ok((await reception.rpc('set_pharmacy_sale_amount', { p_sale_id: saleId, p_final_amount_paise: 100 })).error, 'reception cannot discount')
  assert.ok((await reception.from('pharmacy_sales').update({ final_amount_paise: 100 }).eq('id', saleId).select('id')).error, 'no direct price override')
  const badSale = crypto.randomUUID()
  assert.ok((await reception.rpc('save_pharmacy_sale', { ...saleArgs, p_sale_id: badSale, p_items: [{ ...saleArgs.p_items[0], unit_price_paise: 1 }] })).error, 'saved catalog prices cannot be forged')
  assert.equal(value(await reception.from('pharmacy_sales').select('id').eq('id', badSale)).length, 0, 'invalid sale is atomic')
  value(await doctor.rpc('set_pharmacy_sale_amount', { p_sale_id: saleId, p_final_amount_paise: 4500 }))
  const payArgs = { p_sale_id: saleId, p_payment_method: 'cash', p_expected_amount_paise: 4500 }
  assert.ok((await reception.rpc('confirm_pharmacy_sale', { ...payArgs, p_expected_amount_paise: 100 })).error)
  assert.ok((await reception.rpc('confirm_pharmacy_sale', { ...payArgs, p_expected_amount_paise: 6000 })).error, 'genuine older unpaid pharmacy amounts are held for review, never silently repriced')
  assert.ok((await doctor.rpc('confirm_pharmacy_sale', payArgs)).error, 'doctor does not collect at reception')
  const before = value(await doctor.rpc('get_daily_report'))[0]
  const paid = await Promise.all([reception.rpc('confirm_pharmacy_sale', payArgs), reception.rpc('confirm_pharmacy_sale', payArgs)])
  const pharmacyBillId = value(paid[0])
  assert.equal(value(paid[1]), pharmacyBillId, 'concurrent confirmations create one bill')
  const pharmacyBill = value(await reception.from('bills').select('visit_id, final_amount_paise, bill_line_items(kind, quantity, unit_price_paise, line_total_paise, stock_unit)').eq('id', pharmacyBillId).single())
  assert.equal(pharmacyBill.visit_id, null)
  assert.equal(pharmacyBill.final_amount_paise, 4500)
  assert.deepEqual(pharmacyBill.bill_line_items, [{ kind: 'medicine', quantity: 3, unit_price_paise: 2000, line_total_paise: 6000, stock_unit: 'tablet' }])
  const saleLines = value(await reception.from('pharmacy_sale_items').select('id').eq('sale_id', saleId))
  assert.deepEqual(value(await reception.from('stock_movements').select('quantity_delta').eq('reference_id', saleLines[0].id)), [{ quantity_delta: -3 }])
  const after = value(await doctor.rpc('get_daily_report'))[0]
  assert.equal(after.collections_paise - before.collections_paise, 4500)
  assert.equal(after.discount_paise - before.discount_paise, 1500)
  assert.equal(after.patient_count, before.patient_count, 'sale does not add patient history or queue visit')
  const correctionId = value(await doctor.rpc('set_pharmacy_sale_amount', { p_sale_id: saleId, p_final_amount_paise: 4000 }))
  const corrected = value(await reception.from('bills').select('corrects_bill_id, final_amount_paise').eq('id', correctionId).single())
  assert.equal(corrected.corrects_bill_id, pharmacyBillId)
  assert.equal(corrected.final_amount_paise, 4000)
  assert.equal(value(await reception.from('bills').select('final_amount_paise').eq('id', pharmacyBillId).single()).final_amount_paise, 4500)
  assert.equal(value(await doctor.rpc('set_pharmacy_sale_amount', { p_sale_id: saleId, p_final_amount_paise: 4000 })), correctionId, 'retry cannot create another correction')
  const correctionReport = value(await doctor.rpc('get_daily_report'))[0]
  assert.equal(correctionReport.collections_paise - before.collections_paise, 4000)
  assert.equal(correctionReport.discount_paise - before.discount_paise, 2000, 'only the latest pharmacy correction counts')
  assert.deepEqual(value(await reception.from('stock_movements').select('quantity_delta').eq('reference_id', saleLines[0].id)), [{ quantity_delta: -3 }], 'corrections do not dispense again')
  console.log('PASS: doctor-only discounts, atomic concurrent payments, pharmacy report totals and immutable corrections')
  const other = await signIn('doctor', passwords.TEST_DOCTOR_B_PASSWORD, 'b')
  const admin = await signIn('admin.only', passwords.TEST_ADMIN_ONLY_PASSWORD)
  for (const outsider of [other, admin]) {
    assert.ok((await outsider.rpc('save_pharmacy_sale', { ...saleArgs, p_sale_id: crypto.randomUUID() })).error)
    assert.ok((await outsider.rpc('set_medicine_unit_price', { p_medicine_id: medicine.id, p_stock_unit: 'tablet', p_price_paise: 1 })).error)
    assert.ok((await outsider.rpc('confirm_pharmacy_sale', payArgs)).error)
    assert.ok((await outsider.rpc('set_pharmacy_sale_amount', { p_sale_id: saleId, p_final_amount_paise: 1 })).error)
    assert.equal(value(await outsider.from('pharmacy_sales').select('id').eq('id', saleId)).length, 0)
    assert.equal(value(await outsider.from('pharmacy_sale_items').select('id').eq('sale_id', saleId)).length, 0)
  }
  const anonymous = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { transport: ws } })
  assert.ok((await anonymous.from('pharmacy_sales').select('id')).error)
  assert.ok((await anonymous.rpc('confirm_pharmacy_sale', payArgs)).error)
  assert.ok((await anonymous.rpc('save_pharmacy_sale', saleArgs)).error)
  assert.ok((await reception.rpc('set_medicine_unit_price', { p_medicine_id: medicine.id, p_stock_unit: 'strip', p_price_paise: 2000 })).error, 'cannot reinterpret historical stock as strips')
  assert.ok((await reception.rpc('set_medicine_unit_price', { p_medicine_id: medicine.id, p_stock_unit: 'tablet', p_price_paise: -1 })).error)
  console.log('PASS: clinic isolation, admin/anonymous boundaries, immutable units and non-negative prices')
} finally {
  await Promise.all(clients.map((client) => client.auth.signOut()))
}
