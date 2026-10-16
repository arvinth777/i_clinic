// possible_duplicate_patients: lists likely duplicate pairs for staff review, never merges. Synthetic staging data only.
// Covers migration 20261017020000. Run from the project root: node scripts/duplicate-patients-test.mjs
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
const ph = () => '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0')
const mk = async (name, age, phone) => { const id = crypto.randomUUID(); assert.ifError((await reception.from('patients').insert({ id, clinic_id: clinicId, name: `${name} ${tag}`, age, phone })).error); return id }
const p1 = ph(), p2 = ph()
const A = await mk('Ramesh Kumar', 50, null)            // same name + age as B
const B = await mk('Ramesh Kumar', 50, ph())
const C = await mk('Ramesh K', 31, p1)                  // same phone as D, similar name
const D = await mk('Ramesh Kumar', 29, p1)
const E = await mk('Lakshmi Devi', 60, p2)              // family phone: same phone as F, different person
const F = await mk('Murugan Pillai', 33, p2)
const G = await mk('Ramesh Kumar', 70, null)            // same name as A/B, different age
const H = await mk('Ramesh Kumar', 50, null)            // a third identical record
const ours = new Set([A, B, C, D, E, F, G, H])
const { data, error } = await doctor.rpc('possible_duplicate_patients', { p_clinic_id: clinicId })
assert.ifError(error)
const pairs = data.filter(r => ours.has(r.a.id) && ours.has(r.b.id))
const has = (x, y) => pairs.some(r => (r.a.id === x && r.b.id === y) || (r.a.id === y && r.b.id === x))
await check('same name and same age is listed, k identical records give k-1 pairs', () => { assert.ok([A, B, H].every(x => pairs.some(r => r.a.id === x || r.b.id === x))); assert.equal(pairs.filter(r => r.reason === 'Same name and age').length, 2) })
await check('same phone and a similar name is listed', () => assert.ok(has(C, D)))
await check('a shared family phone with different names is not listed', () => assert.ok(!has(E, F)))
await check('same name but a different age is not listed', () => assert.ok(!has(A, G) && !has(B, G)))
await check('each pair is listed once, with a reason', () => { assert.equal(pairs.length, 3); assert.ok(pairs.every(r => r.reason && r.a.name && r.b.name)) })
await check('anonymous callers are refused', async () => { const anon = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { transport: ws } }); const { data, error } = await anon.rpc('possible_duplicate_patients', { p_clinic_id: clinicId }); assert.ok(error || (data ?? []).length === 0, 'anon must not receive pairs') })
await check('the function only reads: all eight patients still exist', async () => { const { data: rows } = await doctor.from('patients').select('id').in('id', [...ours]); assert.equal(rows.length, 8) })
if (failures.length) { console.log(`\nFAILED ${failures.length}`); process.exit(1) }
console.log('\nPASS: possible duplicate patients')
process.exit(0)
