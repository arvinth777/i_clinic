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
 assert.equal(data(await reception.from('queue_events').select('request_id').eq('request_id',command.p_request_id)).length,1,'retry must not log/move twice')
 assert.ok((await doctor.rpc('queue_visit_action',{...command,p_request_id:crypto.randomUUID()})).error,'doctor cannot reorder')
 assert.ok((await reception.from('visits').update({stage:'with_doctor'}).eq('id',visit.id)).error,'raw stage writes cannot bypass Sent in')
 const otherDoctor=await login('doctor.b@staging.test',passwords.TEST_DOCTOR_B_PASSWORD)
 assert.ok((await otherDoctor.rpc('queue_visit_action',command)).error,'other clinic cannot command this queue')
 assert.equal(data(await otherDoctor.from('queue_events').select('request_id').eq('request_id',command.p_request_id)).length,0)
 const action=(client,name,time)=>client.rpc('queue_visit_action',{p_visit_id:visit.id,p_action:name,p_request_id:crypto.randomUUID(),...(time?{p_occurred_at:time}:{})})
 const original=data(await reception.from('visits').select('queue_position').eq('id',visit.id).single()).queue_position
 data(await action(reception,'not_here'))
 assert.ok((await action(reception,'no_show')).error,'no-show threshold is not automatic or bypassed')
 data(await action(reception,'return_original'))
 assert.equal(data(await reception.from('visits').select('queue_position').eq('id',visit.id).single()).queue_position,original)
 data(await action(reception,'not_here'));data(await action(reception,'return_end'))
 assert.ok(data(await reception.from('visits').select('queue_position').eq('id',visit.id).single()).queue_position>=original)
 const waiting=data(await reception.from('visits').select('id').eq('clinic_id',clinicId).eq('stage','waiting').gte('arrived_at',start.toISOString()).order('queue_position'))
 for(let i=0;i<waiting.findIndex(v=>v.id===visit.id);i++)data(await action(reception,'move_up'))
 assert.ok((await action(reception,'call')).error,'reception cannot call')
 const call={p_visit_id:visit.id,p_action:'call',p_request_id:crypto.randomUUID(),p_occurred_at:new Date(Date.now()-40*60000).toISOString()}
 const calls=await Promise.all([doctor.rpc('queue_visit_action',call),doctor.rpc('queue_visit_action',call)])
 calls.forEach(data)
 assert.ok((await action(doctor,'sent_in')).error,'doctor cannot acknowledge reception')
 data(await action(reception,'not_here',new Date(Date.now()-31*60000).toISOString()))
 data(await action(reception,'no_show'))
 assert.equal(data(await reception.from('visits').select('stage').eq('id',visit.id).single()).stage,'no_show')
 assert.ok((await action(reception,'return_end')).error,'closed token is retained')
 const recheck=data(await reception.from('visits').insert({clinic_id:clinicId,patient_id:patient.id,arrived_at:new Date().toISOString(),complaint:'Synthetic repeat check-in'}).select('token_number').single())
 assert.notEqual(recheck.token_number,visit.token_number,'returning no-show gets a new token')
 const setting=data(await doctor.from('clinics').select('no_show_minutes').eq('id',clinicId).single()).no_show_minutes
 assert.ok((await reception.rpc('set_no_show_minutes',{p_clinic_id:clinicId,p_minutes:45})).error)
 assert.ok((await doctor.rpc('set_no_show_minutes',{p_clinic_id:clinicId,p_minutes:0})).error)
 data(await doctor.rpc('set_no_show_minutes',{p_clinic_id:clinicId,p_minutes:setting}))
 console.log('PASS: absence, original/end return, timed no-show, new token, call retry and clinic/role boundaries')
 console.log('PASS: reception reorder is role-checked and idempotent; stage bypass blocked')
} finally { await Promise.all(clients.map(c=>c.auth.signOut())) }
