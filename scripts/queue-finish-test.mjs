// Finish rule (medicine OR procedure) and no-op queue moves. Synthetic staging only.
// Covers migration 20261012030000. Run from the project root: node scripts/queue-finish-test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
const env = path => Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const app = env('.env.local'), pw = env('.env.test-users.local'), clinicId = '23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname, 'cofnrcgsolluyhghutah.supabase.co')
const login = async (email, password) => { const c = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { transport: ws } }); assert.ifError((await c.auth.signInWithPassword({ email, password })).error); return c }
const ok = r => { assert.ifError(r.error); return r.data }
const failures = []
const check = async (label, fn) => { try { await fn(); console.log('[PASS]', label) } catch (e) { failures.push(label); console.log('[FAIL]', label, '--', String(e.message).split('\n')[0].slice(0, 170)) } }
const reception = await login('reception.a@staging.test', pw.TEST_RECEPTION_A_PASSWORD)
const doctor = await login('doctor.a@staging.test', pw.TEST_DOCTOR_A_PASSWORD)
const tag = Math.random().toString(36).slice(2, 6).toUpperCase()
const patient = ok(await reception.from('patients').insert({ clinic_id: clinicId, name: `Finish AUDITF${tag}`, age: 40 }).select('id').single())
const visit = ok(await reception.from('visits').insert({ clinic_id: clinicId, patient_id: patient.id, arrived_at: new Date().toISOString(), complaint: 'AUDITF' }).select('id').single())
const act = (c, action) => c.rpc('queue_visit_action', { p_visit_id: visit.id, p_action: action, p_request_id: crypto.randomUUID(), p_occurred_at: new Date().toISOString() })
const day = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T00:00:00+05:30').toISOString()
const events = async () => ok(await doctor.from('queue_events').select('request_id').eq('visit_id', visit.id)).length

// bring the visit to the front of today's queue (moves are real queue actions)
for (let n = 0; n < 80; n++) {
  const w = ok(await reception.from('visits').select('id').eq('clinic_id', clinicId).eq('stage', 'waiting').gte('arrived_at', day).order('queue_position').order('id'))
  if (w.findIndex(v => v.id === visit.id) <= 0) break
  ok(await act(reception, 'move_up'))
}
await check('moving up the patient already at the front writes no event and no note', async () => {
  const before = await events()
  const note = ok(await doctor.from('visits').select('queue_note').eq('id', visit.id).single()).queue_note
  ok(await act(reception, 'move_up'))
  assert.equal(await events(), before, 'a no-op move was logged')
  assert.equal(ok(await doctor.from('visits').select('queue_note').eq('id', visit.id).single()).queue_note, note)
})
ok(await act(doctor, 'call')); ok(await act(reception, 'sent_in'))
await check('finish with neither medicine nor procedure is refused', async () => {
  const r = await act(doctor, 'finish'); assert.ok(r.error, 'finish should fail')
})
const proc = ok(await doctor.from('procedures').select('id,default_price_paise').eq('clinic_id', clinicId).limit(1))[0]
assert.ok(proc, 'fixture needs at least one procedure in the catalog')
ok(await doctor.from('visit_procedures').insert({ clinic_id: clinicId, visit_id: visit.id, procedure_id: proc.id, price_paise: proc.default_price_paise }))
const pr = ok(await doctor.rpc('get_pricing_proposal', { p_visit_id: visit.id }))
ok(await doctor.rpc('approve_visit_pricing', { p_visit_id: visit.id, p_final_amount_paise: pr.total_paise, p_expected_total_paise: pr.total_paise, p_expected_revision_number: pr.revision_number, p_request_id: crypto.randomUUID() }))
await check('a procedure-only visit can be finished and goes to billing', async () => {
  ok(await act(doctor, 'finish'))
  assert.equal(ok(await doctor.from('visits').select('stage').eq('id', visit.id).single()).stage, 'ready_to_bill')
})
if (failures.length) { console.log(`\nFAILED ${failures.length}`); process.exit(1) }
console.log('\nPASS: finish rule and no-op moves')
