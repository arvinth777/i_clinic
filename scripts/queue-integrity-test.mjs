// Queue identity, input sanity, patient search and IST report days. Synthetic staging only.
// Covers migration 20261012010000. Run from the project root: node scripts/queue-integrity-test.mjs
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
const check = async (label, fn) => { try { await fn(); console.log('[PASS]', label) } catch (e) { failures.push(label); console.log('[FAIL]', label, '--', String(e.message).split('\n')[0].slice(0, 160)) } }

const reception = await login('reception.a@staging.test', pw.TEST_RECEPTION_A_PASSWORD)
const doctor = await login('doctor.a@staging.test', pw.TEST_DOCTOR_A_PASSWORD)
const tag = Math.random().toString(36).slice(2, 6).toUpperCase()
const phone = '97' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
const name = `Lakshmi Narayanan AUDITQ${tag}`
const patient = ok(await reception.from('patients').insert({ clinic_id: clinicId, name, age: 54, phone }).select('id').single())
const future = new Date(Date.now() + 36 * 3600_000).toISOString()
const visit = ok(await reception.from('visits').insert({ clinic_id: clinicId, patient_id: patient.id, arrived_at: future, complaint: 'AUDITQ' }).select('id,token_number,arrived_at').single())

await check('a future arrived_at is clamped to the server clock', () => assert.ok(new Date(visit.arrived_at) < new Date(Date.now() + 10 * 60_000), `stored ${visit.arrived_at}`))
await check('an offline-replayed (older) arrived_at is kept', async () => {
  const old = new Date(Date.now() - 20 * 60_000).toISOString()
  const v = ok(await reception.from('visits').insert({ clinic_id: clinicId, patient_id: patient.id, arrived_at: old, complaint: 'AUDITQ old' }).select('arrived_at').single())
  assert.equal(new Date(v.arrived_at).getTime(), new Date(old).getTime())
})
for (const [label, patch] of [['token_number', { token_number: 999999 }], ['arrived_at', { arrived_at: new Date().toISOString() }]]) {
  for (const [who, client] of [['reception', reception], ['doctor', doctor]])
    await check(`${who} cannot rewrite ${label} on an existing visit`, async () => assert.ok((await client.from('visits').update(patch).eq('id', visit.id).select('id')).error))
}
await check('follow-up date in the past is rejected', async () => assert.ok((await doctor.from('visits').update({ follow_up_date: '2020-01-01' }).eq('id', visit.id)).error))
await check('follow-up date decades ahead is rejected', async () => assert.ok((await doctor.from('visits').update({ follow_up_date: '2099-12-31' }).eq('id', visit.id)).error))
await check('a follow-up date next week is accepted', async () => ok(await doctor.from('visits').update({ follow_up_date: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10) }).eq('id', visit.id)))
for (const age of [-5, 121, 250000]) await check(`age ${age} is rejected`, async () => assert.ok((await reception.from('patients').insert({ clinic_id: clinicId, name: `AUDITQ${tag} age`, age }).select('id')).error))
await check('age 0 and 120 are accepted', async () => { for (const age of [0, 120]) ok(await reception.from('patients').insert({ clinic_id: clinicId, name: `AUDITQ${tag} age${age}`, age }).select('id')) })

const found = async q => ok(await reception.rpc('search_patients', { p_clinic_id: clinicId, p_query: q })).some(r => r.id === patient.id)
for (const q of ['La', 'Lak', 'Lakshmi', 'lakshmi n', 'Narayanan', 'Lakshmy', `AUDITQ${tag}`]) await check(`name search "${q}" finds the patient`, async () => assert.ok(await found(q)))
for (const [label, q] of [['first digits', phone.slice(0, 4)], ['last 4 digits', phone.slice(-4)], ['digits with a space', phone.slice(0, 5) + ' ' + phone.slice(5)], ['+91 prefix', '+91' + phone]]) await check(`phone search by ${label}`, async () => assert.ok(await found(q)))
await check("today's token number finds the patient", async () => assert.ok(await found(String(visit.token_number))))
await check('"%" is a literal, not a wildcard for every patient', async () => assert.ok(ok(await reception.rpc('search_patients', { p_clinic_id: clinicId, p_query: '%' })).length === 0))
await check('an unrelated name does not match', async () => assert.equal(await found('Zzzzqq'), false))

await check('get_daily_report() defaults to the IST day', async () => {
  const istToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const a = ok(await doctor.rpc('get_daily_report', {}))[0], b = ok(await doctor.rpc('get_daily_report', { p_date: istToday }))[0]
  assert.deepEqual(a, b)
})
await check("today's IST visits are counted in today's report", async () => {
  const istToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const r = ok(await doctor.rpc('get_daily_report', { p_date: istToday }))[0]
  assert.ok(r.patient_count >= 1, `patient_count ${r.patient_count}`)
})
if (failures.length) { console.log(`\nFAILED ${failures.length}:`); failures.forEach(f => console.log(' -', f)); process.exit(1) }
console.log('\nPASS: queue identity, validation, search, IST report days')
