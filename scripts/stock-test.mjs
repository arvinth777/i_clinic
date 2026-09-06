// TDD for Phase B (docs/build-plan.md): stock. "Tests first" is this
// phase's own explicit instruction (AGENTS.md tdd checkpoint -- this
// touches money and quantities). Same convention as every other script:
// plain, against live staging, signed in as the real roles, no framework.
// Run from the project root: node scripts/stock-test.mjs
//
// Run before the migration exists, every section below is expected to
// throw on its first query against stock_points/medicine_stock/etc --
// that crash *is* red. Run again after 20260906200000_phase_b_stock.sql
// is applied, everything should pass -- that's green.

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

async function makeMedicine(client, name, price) {
  const { data, error } = await client.from('medicines').insert({ clinic_id: CLINIC_A_ID, name: `${name} ${Date.now()}${Math.random()}`, price_paise: price }).select('id').single()
  if (error) throw new Error(`fixture: creating medicine failed: ${error.message}`)
  return data.id
}

async function makeVisit(client, complaint) {
  const stamp = Date.now() + Math.random()
  const { data: patient, error: patientErr } = await client.from('patients').insert({ clinic_id: CLINIC_A_ID, name: `Stock Test Patient ${stamp}`, age: 45 }).select('id').single()
  if (patientErr) throw new Error(`fixture: creating patient failed: ${patientErr.message}`)
  const { data: visit, error: visitErr } = await client.from('visits').insert({ clinic_id: CLINIC_A_ID, patient_id: patient.id, arrived_at: new Date().toISOString(), complaint }).select('id').single()
  if (visitErr) throw new Error(`fixture: creating visit failed: ${visitErr.message}`)
  return visit.id
}

async function prescribe(client, visitId, medicineId, quantityDispensed) {
  const { data: rx, error: rxErr } = await client.from('prescriptions').insert({ clinic_id: CLINIC_A_ID, visit_id: visitId }).select('id').single()
  if (rxErr) throw new Error(`fixture: creating prescription failed: ${rxErr.message}`)
  const { data: item, error } = await client
    .from('prescription_items')
    .insert({ clinic_id: CLINIC_A_ID, prescription_id: rx.id, medicine_id: medicineId, duration_days: 5, quantity_dispensed: quantityDispensed })
    .select('id')
    .single()
  if (error) throw new Error(`prescribing failed: ${error.message}`)
  return item.id
}

async function stockQuantity(client, medicineId, stockPointName) {
  const { data: point, error: pointErr } = await client.from('stock_points').select('id').eq('clinic_id', CLINIC_A_ID).eq('name', stockPointName).single()
  if (pointErr) throw new Error(`reading stock point failed: ${pointErr.message}`)
  const { data, error } = await client.from('medicine_stock').select('quantity').eq('medicine_id', medicineId).eq('stock_point_id', point.id).maybeSingle()
  if (error) throw new Error(`reading medicine_stock failed: ${error.message}`)
  return { quantity: data?.quantity ?? 0, stockPointId: point.id }
}

const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)
const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)
console.log('signed in as doctor.a, reception.a\n')

// Section on column types is deliberately not a script test -- integer vs
// bigint is a migration-file fact, checked by reading the migration
// (information_schema.columns isn't reachable through PostgREST anyway).

// ================================================================
// Section 2 -- purchases add quantity to the chosen stock point
// ================================================================
let medA, counterPointId
{
  medA = await makeMedicine(doctorA, 'Stock Test Med A', 1000)
  const before = await stockQuantity(receptionA, medA, 'Counter')
  counterPointId = before.stockPointId
  report('a brand-new medicine starts at 0 stock', before.quantity === 0, JSON.stringify(before))

  const { data: supplier, error: supErr } = await receptionA.from('suppliers').insert({ clinic_id: CLINIC_A_ID, name: `Test Supplier ${Date.now()}`, phone: '9800000000' }).select('id').single()
  if (supErr) throw new Error(`fixture: creating supplier failed: ${supErr.message}`)

  const { data: purchaseId, error: purchaseErr } = await receptionA.rpc('record_purchase', {
    p_clinic_id: CLINIC_A_ID,
    p_supplier_id: supplier.id,
    p_invoice_number: `INV-${Date.now()}`,
    p_purchase_date: new Date().toISOString().slice(0, 10),
    p_stock_point_id: counterPointId,
    p_items: [{ medicine_id: medA, quantity: 50, cost_price_paise: 800 }],
  })
  report('recording a purchase succeeds', !purchaseErr && !!purchaseId, purchaseErr?.message)

  const after = await stockQuantity(receptionA, medA, 'Counter')
  report('recording a purchase adds quantity to the chosen stock point', after.quantity === 50, JSON.stringify(after))
}

// ================================================================
// Section 3 -- a transfer moves quantity between points without
// changing the total
// ================================================================
{
  const beforeCounter = await stockQuantity(receptionA, medA, 'Counter')
  const beforeStoreroom = await stockQuantity(receptionA, medA, 'Storeroom')
  const totalBefore = beforeCounter.quantity + beforeStoreroom.quantity

  const { error: transferErr } = await doctorA.rpc('create_stock_transfer', {
    p_clinic_id: CLINIC_A_ID,
    p_medicine_id: medA,
    p_from_stock_point_id: beforeCounter.stockPointId,
    p_to_stock_point_id: beforeStoreroom.stockPointId,
    p_quantity: 20,
    p_notes: 'stock-test.mjs transfer',
  })
  report('a transfer succeeds', !transferErr, transferErr?.message)

  const afterCounter = await stockQuantity(receptionA, medA, 'Counter')
  const afterStoreroom = await stockQuantity(receptionA, medA, 'Storeroom')
  const totalAfter = afterCounter.quantity + afterStoreroom.quantity

  report('transfer moves quantity from the source', afterCounter.quantity === beforeCounter.quantity - 20, JSON.stringify(afterCounter))
  report('transfer adds quantity to the destination', afterStoreroom.quantity === beforeStoreroom.quantity + 20, JSON.stringify(afterStoreroom))
  report('a transfer does not change the total across both points', totalAfter === totalBefore, `before ${totalBefore}, after ${totalAfter}`)
}

// ================================================================
// Section 4 -- confirming a bill deducts each dispensed medicine from
// the counter stock point; a medicine removed before finishing (
// "dispensed externally") deducts nothing and bills nothing for it
// ================================================================
{
  const medB = await makeMedicine(doctorA, 'Stock Test Med B (dispensed)', 500)
  const medC = await makeMedicine(doctorA, 'Stock Test Med C (dispensed externally)', 700)
  // stock both up first so the deduction has something real to subtract from
  await doctorA.rpc('record_purchase', {
    p_clinic_id: CLINIC_A_ID,
    p_supplier_id: (await receptionA.from('suppliers').select('id').eq('clinic_id', CLINIC_A_ID).limit(1).single()).data.id,
    p_invoice_number: `INV-B-${Date.now()}`,
    p_purchase_date: new Date().toISOString().slice(0, 10),
    p_stock_point_id: counterPointId,
    p_items: [
      { medicine_id: medB, quantity: 30, cost_price_paise: 400 },
      { medicine_id: medC, quantity: 30, cost_price_paise: 500 },
    ],
  })

  const visitId = await makeVisit(doctorA, 'stock deduction test visit')
  await doctorA.from('visits').update({ stage: 'with_doctor' }).eq('id', visitId)
  await prescribe(doctorA, visitId, medB, 4) // dispensed for real
  const itemCId = await prescribe(doctorA, visitId, medC, 6) // will be "dispensed externally" -- removed below
  // doctor removes medC before finishing -- the PRD's "bought outside" path
  await doctorA.from('prescription_items').delete().eq('id', itemCId)

  // moving to packing flips final_amount_set true automatically
  // (trg_ensure_final_amount_set_on_packing), same as the real app flow
  await doctorA.from('visits').update({ stage: 'packing' }).eq('id', visitId)
  await receptionA.from('visits').update({ stage: 'ready_at_reception' }).eq('id', visitId)

  const beforeB = await stockQuantity(doctorA, medB, 'Counter')
  const beforeC = await stockQuantity(doctorA, medC, 'Counter')

  const { data: billId, error: billErr } = await receptionA.rpc('confirm_bill', { p_visit_id: visitId, p_payment_method: 'cash' })
  report('confirm_bill still succeeds with stock deduction wired in', !billErr && !!billId, billErr?.message)

  const { data: lineItems } = await receptionA.from('bill_line_items').select('description').eq('bill_id', billId)
  const billedMedC = (lineItems ?? []).some((r) => r.description?.includes('Med C'))
  report('the bill does not charge for a medicine removed before finishing ("dispensed externally")', !billedMedC, JSON.stringify(lineItems))

  const afterB = await stockQuantity(doctorA, medB, 'Counter')
  const afterC = await stockQuantity(doctorA, medC, 'Counter')
  report('confirming the bill deducts the dispensed medicine from the counter', afterB.quantity === beforeB.quantity - 4, `before ${beforeB.quantity}, after ${afterB.quantity}`)
  report('"dispensed externally" (removed before finishing) deducts nothing', afterC.quantity === beforeC.quantity, `before ${beforeC.quantity}, after ${afterC.quantity}`)
}

// ================================================================
// Section 5 -- a deduction taking stock below zero still applies, and
// the item is flagged (queryable as negative stock, not blocked)
// ================================================================
{
  const medD = await makeMedicine(doctorA, 'Stock Test Med D (goes negative)', 300)
  // deliberately no purchase -- this medicine starts at 0 stock
  const visitId = await makeVisit(doctorA, 'negative stock test visit')
  await doctorA.from('visits').update({ stage: 'with_doctor' }).eq('id', visitId)
  await prescribe(doctorA, visitId, medD, 3)
  await doctorA.from('visits').update({ stage: 'packing' }).eq('id', visitId)
  await receptionA.from('visits').update({ stage: 'ready_at_reception' }).eq('id', visitId)

  const { error: billErr } = await receptionA.rpc('confirm_bill', { p_visit_id: visitId, p_payment_method: 'cash' })
  report('confirm_bill does not block on a deduction that would go negative', !billErr, billErr?.message)

  const after = await stockQuantity(doctorA, medD, 'Counter')
  report('the deduction still applies, going negative rather than clamping at 0', after.quantity === -3, JSON.stringify(after))
}

// ================================================================
// Section 6 -- a monthly count sets stock to the counted figure and
// saves the gap (not discarded)
// ================================================================
{
  const medE = await makeMedicine(doctorA, 'Stock Test Med E (count)', 200)
  const supplierId = (await receptionA.from('suppliers').select('id').eq('clinic_id', CLINIC_A_ID).limit(1).single()).data.id
  await receptionA.rpc('record_purchase', {
    p_clinic_id: CLINIC_A_ID,
    p_supplier_id: supplierId,
    p_invoice_number: `INV-E-${Date.now()}`,
    p_purchase_date: new Date().toISOString().slice(0, 10),
    p_stock_point_id: counterPointId,
    p_items: [{ medicine_id: medE, quantity: 40, cost_price_paise: 150 }],
  })
  // expected is 40; the real physical count comes in at 35 -- a gap of -5
  const { data: countId, error: countErr } = await receptionA.rpc('record_stock_count', {
    p_clinic_id: CLINIC_A_ID,
    p_stock_point_id: counterPointId,
    p_lines: [{ medicine_id: medE, counted_quantity: 35 }],
  })
  report('recording a monthly count succeeds', !countErr && !!countId, countErr?.message)

  const after = await stockQuantity(doctorA, medE, 'Counter')
  report('the monthly count sets stock to the counted figure', after.quantity === 35, JSON.stringify(after))

  const { data: line, error: lineErr } = await receptionA.from('stock_count_lines').select('expected_quantity, counted_quantity, gap_quantity').eq('stock_count_id', countId).eq('medicine_id', medE).single()
  report('the gap is saved, not discarded', !lineErr && line?.expected_quantity === 40 && line?.counted_quantity === 35 && line?.gap_quantity === -5, JSON.stringify(line))
}

// ================================================================
// Section 7 -- manual adjustment with a reason
// ================================================================
{
  const medF = await makeMedicine(doctorA, 'Stock Test Med F (adjustment)', 100)
  const { error: adjErr } = await receptionA.rpc('adjust_stock', {
    p_clinic_id: CLINIC_A_ID,
    p_medicine_id: medF,
    p_stock_point_id: counterPointId,
    p_quantity_delta: -2,
    p_reason: 'damaged in transit',
  })
  report('a manual adjustment succeeds', !adjErr, adjErr?.message)
  const after = await stockQuantity(doctorA, medF, 'Counter')
  report('the adjustment applies the delta', after.quantity === -2, JSON.stringify(after))

  const { error: noReasonErr } = await receptionA.rpc('adjust_stock', {
    p_clinic_id: CLINIC_A_ID,
    p_medicine_id: medF,
    p_stock_point_id: counterPointId,
    p_quantity_delta: 5,
    p_reason: '',
  })
  report('a manual adjustment requires a reason', !!noReasonErr, noReasonErr?.message)
}

// ================================================================
// Section 8 -- reopening a paid visit and re-confirming the bill must
// not deduct the same dispensing from stock twice. Found by the Phase B
// security-review checkpoint: confirm_bill's early-return only fires
// when the visit's CURRENT stage is 'paid', so a doctor reopening a
// closed visit (a real, allowed flow) and reception re-confirming ran
// the whole body again, including the stock deduction, against the same
// prescription_items.
// ================================================================
{
  const medG = await makeMedicine(doctorA, 'Stock Test Med G (reopen)', 600)
  await doctorA.rpc('record_purchase', {
    p_clinic_id: CLINIC_A_ID,
    p_supplier_id: (await receptionA.from('suppliers').select('id').eq('clinic_id', CLINIC_A_ID).limit(1).single()).data.id,
    p_invoice_number: `INV-G-${Date.now()}`,
    p_purchase_date: new Date().toISOString().slice(0, 10),
    p_stock_point_id: counterPointId,
    p_items: [{ medicine_id: medG, quantity: 30, cost_price_paise: 400 }],
  })

  const visitId = await makeVisit(doctorA, 'reopen double-deduction test visit')
  await doctorA.from('visits').update({ stage: 'with_doctor' }).eq('id', visitId)
  await prescribe(doctorA, visitId, medG, 5)
  await doctorA.from('visits').update({ stage: 'packing' }).eq('id', visitId)
  await receptionA.from('visits').update({ stage: 'ready_at_reception' }).eq('id', visitId)

  const beforeFirstBill = await stockQuantity(doctorA, medG, 'Counter')
  await receptionA.rpc('confirm_bill', { p_visit_id: visitId, p_payment_method: 'cash' })
  const afterFirstBill = await stockQuantity(doctorA, medG, 'Counter')
  report('first confirm deducts once', afterFirstBill.quantity === beforeFirstBill.quantity - 5, JSON.stringify(afterFirstBill))

  // Doctor reopens the closed visit (a real, allowed flow -- security-review.md's
  // "only doctor can reopen a closed visit"), reception re-confirms.
  await doctorA.from('visits').update({ stage: 'ready_at_reception' }).eq('id', visitId)
  const { error: rebillErr } = await receptionA.rpc('confirm_bill', { p_visit_id: visitId, p_payment_method: 'cash' })
  report('rebilling a reopened visit still succeeds', !rebillErr, rebillErr?.message)
  const afterRebill = await stockQuantity(doctorA, medG, 'Counter')
  report('rebilling a reopened visit does not deduct stock a second time', afterRebill.quantity === afterFirstBill.quantity, `after first bill ${afterFirstBill.quantity}, after rebill ${afterRebill.quantity}`)
}

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
