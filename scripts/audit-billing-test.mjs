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
} finally {
  await Promise.all(clients.map((client) => client.auth.signOut()))
}
