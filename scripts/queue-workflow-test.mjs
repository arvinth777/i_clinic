import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
const env = path => Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => [l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const app = env('.env.local'), passwords = env('.env.test-users.local')
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname, 'cofnrcgsolluyhghutah.supabase.co')
const clients = []
async function login(email, password) { const c = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false},realtime:{transport:ws}}); assert.ifError((await c.auth.signInWithPassword({email,password})).error); clients.push(c); return c }
function data(r) { assert.ifError(r.error); return r.data }
try {
 const doctor = await login('doctor.a@staging.test',passwords.TEST_DOCTOR_A_PASSWORD)
 const reception = await login('reception.a@staging.test',passwords.TEST_RECEPTION_A_PASSWORD)
 const clinicId = '23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
 const patient = data(await reception.from('patients').insert({clinic_id:clinicId,name:`Queue synthetic ${crypto.randomUUID()}`,age:40}).select('id').single())
 const start = new Date(); start.setHours(0,0,0,0)
 const visit = data(await reception.from('visits').insert({clinic_id:clinicId,patient_id:patient.id,arrived_at:new Date(start.getTime()+1000).toISOString(),complaint:'Synthetic queue verification'}).select('id,token_number').single())
 const command = {p_visit_id:visit.id,p_action:'move_up',p_request_id:crypto.randomUUID(),p_reason:'Synthetic verification'}
 data(await reception.rpc('queue_visit_action',command))
 data(await reception.rpc('queue_visit_action',command))
 assert.equal(data(await reception.from('queue_events').select('id').eq('request_id',command.p_request_id)).length,1,'retry must not log/move twice')
 assert.ok((await doctor.rpc('queue_visit_action',{...command,p_request_id:crypto.randomUUID()})).error,'doctor cannot reorder')
 assert.ok((await reception.from('visits').update({stage:'with_doctor'}).eq('id',visit.id)).error,'raw stage writes cannot bypass Sent in')
 console.log('PASS: reception reorder is role-checked and idempotent; stage bypass blocked')
} finally { await Promise.all(clients.map(c=>c.auth.signOut())) }
