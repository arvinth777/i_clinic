// Height and weight on patients: stored, validated by the database, readable by the doctor. Synthetic staging data only.
// Covers migration 20261017010000. Run from the project root: node scripts/patient-body-test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
const env = p => Object.fromEntries(readFileSync(p, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const app = env('.env.local'), pw = env('.env.test-users.local'), clinicId = '23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname, 'cofnrcgsolluyhghutah.supabase.co')
const login = async (email, password) => { const c = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: ws } }); assert.ifError((await c.auth.signInWithPassword({ email, password })).error); return c }
const reception = await login('reception.a@staging.test', pw.TEST_RECEPTION_A_PASSWORD)
const doctor = await login('doctor.a@staging.test', pw.TEST_DOCTOR_A_PASSWORD)
const failures = []
const check = async (label, fn) => { try { await fn(); console.log('[PASS]', label) } catch (e) { failures.push(label); console.log('[FAIL]', label, '--', String(e.message).split('\n')[0].slice(0, 160)) } }
const tag = Math.random().toString(36).slice(2, 6).toUpperCase()
const add = (extra, n = 'x') => reception.from('patients').insert({ id: crypto.randomUUID(), clinic_id: clinicId, name: `BODY${tag} ${n}`, age: 40, ...extra })

await check('a valid height and weight are stored, and the doctor reads them back', async () => {
  const id = crypto.randomUUID()
  assert.ifError((await reception.from('patients').insert({ id, clinic_id: clinicId, name: `BODY${tag} valid`, age: 40, height_cm: 165.5, weight_kg: 62.3 })).error)
  const { data, error } = await doctor.from('patients').select('height_cm, weight_kg').eq('id', id).single()
  assert.ifError(error); assert.equal(Number(data.height_cm), 165.5); assert.equal(Number(data.weight_kg), 62.3)
})
await check('both are optional, and either can be given alone', async () => {
  assert.ifError((await add({}, 'none')).error)
  assert.ifError((await add({ height_cm: 150 }, 'h')).error)
  assert.ifError((await add({ weight_kg: 48 }, 'w')).error)
})
for (const [label, extra] of [['height 29.9 cm is rejected', { height_cm: 29.9 }], ['height 261 cm is rejected', { height_cm: 261 }], ['weight 0.9 kg is rejected', { weight_kg: 0.9 }], ['weight 401 kg is rejected', { weight_kg: 401 }], ['a negative weight is rejected', { weight_kg: -5 }]]) {
  await check(label, async () => { const { error } = await add(extra, 'bad'); assert.ok(error, 'insert should fail'); assert.equal(error.code, '23514', `expected a check violation, got ${error.code}: ${error.message}`) })
}
await check('the limits themselves are accepted (30/260 cm, 1/400 kg)', async () => {
  assert.ifError((await add({ height_cm: 30, weight_kg: 1 }, 'lo')).error)
  assert.ifError((await add({ height_cm: 260, weight_kg: 400 }, 'hi')).error)
})
if (failures.length) { console.log(`\nFAILED ${failures.length}`); process.exit(1) }
console.log('\nPASS: patient height and weight')
process.exit(0)
