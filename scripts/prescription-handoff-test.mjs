import {sendToBilling} from './clinic-workflow-fixture.mjs'
// Prescription save/read boundaries; synthetic staging only.
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

try {
  const doctor = await signIn('doctor', passwords.TEST_DOCTOR_A_PASSWORD)
  const reception = await signIn('reception', passwords.TEST_RECEPTION_A_PASSWORD)
  const patient = value(await doctor.from('patients').insert({ clinic_id: clinicId, name: `Handoff synthetic ${crypto.randomUUID()}`, age: 40 }).select('id').single())
  const visit = value(await doctor.from('visits').insert({ clinic_id: clinicId, patient_id: patient.id, arrived_at: new Date().toISOString(), complaint: 'Synthetic UI verification' }).select('id').single())
  const medicine = value(await doctor.from('medicines').insert({ clinic_id: clinicId, name: `Handoff medicine ${crypto.randomUUID()}`, price_paise: 1000, strength_options: ['500 mg'] }).select('id').single())
  value(await doctor.rpc('set_medicine_unit_price', { p_medicine_id: medicine.id, p_stock_unit: 'tablet', p_price_paise: 1000 }))
  const args = { p_prescription_id: crypto.randomUUID(), p_visit_id: visit.id, p_items: [{ id: crypto.randomUUID(), medicine_id: medicine.id, drug_type: 'Tablet', strength: '500 mg', before_after_food: 'After food', dosage_frequency: '0.5-0-0.5', duration_days: 5, quantity_dispensed: 5 }], p_diagnosis: 'Synthetic saved diagnosis', p_advice: 'Synthetic saved advice <not HTML>' }
  assert.ok((await reception.rpc('save_prescription', args)).error, 'reception cannot issue clinical instructions')
  value(await doctor.rpc('save_prescription', args))
  value(await doctor.rpc('save_prescription', args))
  const saved = value(await doctor.from('prescriptions').select('diagnosis, advice, prescription_items(dosage_frequency)').eq('id', args.p_prescription_id).single())
  assert.equal(saved.diagnosis, args.p_diagnosis)
  assert.equal(saved.advice, args.p_advice)
  assert.deepEqual(saved.prescription_items, [{ dosage_frequency: '0.5-0-0.5' }], 'retry preserves one medicine and a custom dose')
  console.log('PASS: clinical fields and custom dose saved atomically, doctor-only, retry once')
  const otherDoctor = await signIn('doctor', passwords.TEST_DOCTOR_B_PASSWORD, 'b')
  const admin = await signIn('admin.only', passwords.TEST_ADMIN_ONLY_PASSWORD)
  const anonymous = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { transport: ws } })
  for (const [role, client] of [['other clinic', otherDoctor], ['admin', admin], ['anonymous', anonymous]]) {
    assert.ok((await client.rpc('save_prescription', { ...args, p_prescription_id: crypto.randomUUID() })).error, role + ' must not issue this prescription')
    const read = await client.from('prescriptions').select('id, diagnosis, advice').eq('id', args.p_prescription_id)
    assert.ok(read.error || read.data.length === 0, role + ' must not read clinical notes')
  }
  const edit = await reception.from('prescriptions').update({ diagnosis: 'Unauthorized replacement' }).eq('id', args.p_prescription_id).select('id')
  assert.ok(edit.error || edit.data.length === 0, 'reception cannot directly edit clinical notes')
  assert.equal(value(await doctor.from('prescriptions').select('diagnosis').eq('id', args.p_prescription_id).single()).diagnosis, args.p_diagnosis)
  console.log('PASS: direct reception edits blocked; clinical notes isolated from other clinics, admin and anonymous access')
  assert.deepEqual(value(await reception.rpc('get_visit_billing_detail', { p_visit_id: visit.id })), [], 'reception must not read clinical instructions before handoff')
  await sendToBilling(doctor,reception,clinicId,visit.id)
  const printable = value(await reception.rpc('get_visit_billing_detail', { p_visit_id: visit.id }))
  const printedMedicine = printable.find(row => row.kind === 'medicine')
  assert.ok(printedMedicine, 'reception receives medicine billing detail after handoff')
  assert.equal(printedMedicine.diagnosis, null, 'reception billing read masks diagnosis')
  assert.equal(printedMedicine.advice, null, 'reception billing read masks advice')
  assert.equal(printedMedicine.dosage_frequency, null, 'reception billing read masks dose')
  assert.deepEqual(value(await reception.from('prescriptions').select('id').eq('id', args.p_prescription_id)), [], 'printing must not grant reception unrestricted clinical history')
  for (const [role, client] of [['other clinic', otherDoctor], ['admin', admin], ['anonymous', anonymous]]) {
    const result = await client.rpc('get_visit_billing_detail', { p_visit_id: visit.id })
    assert.ok(result.error || result.data.length === 0, role + ' must not read the billing detail')
  }
  console.log('PASS: reception receives only billing fields after handoff, with role/clinic isolation')
} finally {
  await Promise.all(clients.map(client => client.auth.signOut({scope:'local'})))
}
