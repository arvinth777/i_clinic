// New-patient check-in retry: the patient write is an upsert on the client-generated id, so retrying after the
// visit step failed rewrites the same patient instead of registering a second one. Synthetic staging data only.
// Run from the project root: node scripts/checkin-retry-test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
const env = p => Object.fromEntries(readFileSync(p, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const app = env('.env.local'), pw = env('.env.test-users.local'), clinicId = '23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname, 'cofnrcgsolluyhghutah.supabase.co')
const reception = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { transport: ws } })
assert.ifError((await reception.auth.signInWithPassword({ email: 'reception.a@staging.test', password: pw.TEST_RECEPTION_A_PASSWORD })).error)
const tag = Math.random().toString(36).slice(2, 6).toUpperCase()
const id = crypto.randomUUID(), visitId = crypto.randomUUID()
const row = name => ({ id, clinic_id: clinicId, name, age: 44 })
assert.ifError((await reception.from('patients').upsert(row(`RETRY${tag} first`), { onConflict: 'id' })).error)
// ...the visit step is rejected here in the real flow; the user corrects a typo and submits again with the same ids
assert.ifError((await reception.from('patients').upsert(row(`RETRY${tag} corrected`), { onConflict: 'id' })).error)
assert.ifError((await reception.from('visits').insert({ id: visitId, clinic_id: clinicId, patient_id: id, arrived_at: new Date().toISOString(), complaint: 'retry check' })).error)
const { data } = await reception.from('patients').select('id, name').eq('clinic_id', clinicId).like('name', `RETRY${tag}%`)
assert.equal(data.length, 1, 'one patient, not two')
assert.equal(data[0].name, `RETRY${tag} corrected`, 'the retry carries the corrected details')
const { data: visits } = await reception.from('visits').select('id').eq('patient_id', id)
assert.equal(visits.length, 1)
console.log('PASS: new-patient check-in retry is idempotent')
process.exit(0)
