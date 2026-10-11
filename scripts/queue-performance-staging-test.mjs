// Synthetic staging only; service key is used solely to remove this run's fixtures.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
const env = path => Object.fromEntries(readFileSync(path,'utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const app=env('.env.local'), passwords=env('.env.test-users.local')
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co')
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref','cofnrcgsolluyhghutah','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))
const service=keys.find(k=>k.name==='service_role')?.api_key
assert.ok(service,'staging fixture cleanup needs the existing service key')
const options={auth:{persistSession:false},realtime:{transport:ws}}
const admin=createClient(app.VITE_SUPABASE_URL,service,options)
const doctor=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,options)
const reception=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,options)
const other=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,options)
const checked=r=>{assert.ifError(r.error);return r.data}
const clinic='23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
const midnight=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})+'T00:00:00+05:30'
let patient,rep
try {
 checked(await doctor.auth.signInWithPassword({email:'doctor.a@staging.test',password:passwords.TEST_DOCTOR_A_PASSWORD}))
 checked(await reception.auth.signInWithPassword({email:'reception.a@staging.test',password:passwords.TEST_RECEPTION_A_PASSWORD}))
 checked(await other.auth.signInWithPassword({email:'doctor.b@staging.test',password:passwords.TEST_DOCTOR_B_PASSWORD}))
 patient=checked(await reception.from('patients').insert({clinic_id:clinic,name:`Performance synthetic ${crypto.randomUUID()}`,age:40}).select('id').single())
 const events=[]
 const channel=doctor.channel(`performance-${crypto.randomUUID()}`)
 for(const table of ['visits','pharma_rep_checkins','queue_events']) channel.on('postgres_changes',{event:'INSERT',schema:'public',table,filter:`clinic_id=eq.${clinic}`},()=>events.push({table,at:performance.now()}))
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Realtime subscription timed out')),15000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve()}})})
 const started=performance.now()
 const today=checked(await reception.from('visits').insert({clinic_id:clinic,patient_id:patient.id,arrived_at:new Date().toISOString(),complaint:'Synthetic performance check'}).select('id').single())
 rep=checked(await reception.from('pharma_rep_checkins').insert({clinic_id:clinic,rep_name:'Performance synthetic',company:'Test only',arrived_at:new Date().toISOString(),checked_in_by:checked(await reception.auth.getUser()).user.id}).select('id').single())
 checked(await reception.rpc('queue_visit_action',{p_visit_id:today.id,p_action:'not_here',p_request_id:crypto.randomUUID()}))
 const deadline=Date.now()+15000
 while(events.length<3&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,100))
 for(const table of ['visits','pharma_rep_checkins','queue_events']) assert.ok(events.some(e=>e.table===table),`${table} must reach the doctor's channel`)
 const latency=Object.fromEntries(['visits','pharma_rep_checkins','queue_events'].map(table=>[table,Math.round(events.find(e=>e.table===table).at-started)]))
 assert.equal(checked(await other.from('pharma_rep_checkins').select('id').eq('id',rep.id)).length,0,'other clinic cannot read rep arrivals')
 const earlier=Array.from({length:1005},(_,i)=>({clinic_id:clinic,patient_id:patient.id,arrived_at:new Date(Date.now()-10*86400000+i*1000).toISOString(),complaint:'Synthetic history scaling'}))
 for(let offset=0;offset<earlier.length;offset+=100) checked(await reception.from('visits').insert(earlier.slice(offset,offset+100)))
 const ids=new Set()
 for(let offset=0;;offset+=50){const page=checked(await reception.from('visits').select('id').eq('clinic_id',clinic).eq('patient_id',patient.id).lt('arrived_at',midnight).in('stage',['waiting','called','with_doctor','not_here','ready_to_bill']).order('arrived_at',{ascending:false}).order('id').range(offset,offset+49));for(const row of page)ids.add(row.id);if(page.length<50)break}
 assert.equal(ids.size,1005,'server pagination reaches every older visit beyond the 1000-row API cap')
 const live=checked(await doctor.from('visits').select('id').eq('clinic_id',clinic).eq('patient_id',patient.id).gte('arrived_at',midnight))
 assert.equal(live.length,1);assert.equal(live[0].id,today.id,'today patient is not buried under historical open visits')
 console.log('PASS: 1005 older visits paged, today reachable, cross-clinic rep isolation, doctor realtime deliveries (ms from check-in request)',latency)
 await doctor.removeChannel(channel)
} finally {
 if(rep)checked(await admin.from('pharma_rep_checkins').delete().eq('id',rep.id))
 if(patient){
  const rows=[]
  for(let offset=0;;offset+=100){const page=checked(await admin.from('visits').select('id').eq('patient_id',patient.id).order('id').range(offset,offset+99));rows.push(...page);if(page.length<100)break}
  for(let offset=0;offset<rows.length;offset+=100) {
   const ids=rows.slice(offset,offset+100).map(v=>v.id)
   checked(await admin.from('queue_events').delete().in('visit_id',ids))
   checked(await admin.from('visit_pricing').delete().in('visit_id',ids))
  }
  checked(await admin.from('visits').delete().eq('patient_id',patient.id))
  checked(await admin.from('patients').delete().eq('id',patient.id))
  assert.equal(checked(await admin.from('patients').select('id').eq('id',patient.id)).length,0,'this run fixtures removed')
 }
 await doctor.removeAllChannels()
 await Promise.all([doctor,reception,other].map(c=>c.auth.signOut({scope:'local'})))
}
