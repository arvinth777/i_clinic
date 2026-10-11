import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {createClient} from '@supabase/supabase-js'
import ws from 'ws'
const env=p=>Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const app=env('.env.local'),passwords=env('.env.test-users.local'),clinic='23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co')
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref','cofnrcgsolluyhghutah','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))
const client=key=>createClient(app.VITE_SUPABASE_URL,key,{auth:{persistSession:false},realtime:{transport:ws}})
const doctor=client(app.VITE_SUPABASE_ANON_KEY),reception=client(app.VITE_SUPABASE_ANON_KEY),service=client(keys.find(k=>k.name==='service_role').api_key)
const checked=r=>{assert.ifError(r.error);return r.data}
let patient,visit
const events=[]
try{
 checked(await doctor.auth.signInWithPassword({email:'doctor.a@staging.test',password:passwords.TEST_DOCTOR_A_PASSWORD}))
 checked(await reception.auth.signInWithPassword({email:'reception.a@staging.test',password:passwords.TEST_RECEPTION_A_PASSWORD}))
 const day=new Date(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})+'T00:00:00+05:30').toISOString()
 assert.equal(checked(await doctor.from('visits').select('id').eq('clinic_id',clinic).gte('arrived_at',day).in('stage',['called','with_doctor'])).length,0,'Do not disturb an active consultation')
 for(const [c,role] of [[doctor,'doctor'],[reception,'reception']]){
  const channel=c.channel('alerts-e2e-'+crypto.randomUUID()).on('postgres_changes',{event:'INSERT',schema:'public',table:'queue_events',filter:'clinic_id=eq.'+clinic},event=>{if(event.new.visit_id===visit?.id) events.push({role,action:event.new.action,at:performance.now()})})
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Realtime unavailable')),15000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve()}})})
 }
 patient=checked(await reception.from('patients').insert({clinic_id:clinic,name:'SYNTHETIC Alert connection verification',age:40}).select('id').single())
 visit=checked(await reception.from('visits').insert({clinic_id:clinic,patient_id:patient.id,arrived_at:new Date().toISOString(),complaint:'Synthetic connection check only'}).select('id,token_number').single())
 const waiting=checked(await reception.from('visits').select('id').eq('clinic_id',clinic).gte('arrived_at',day).eq('stage','waiting').order('queue_position').order('id'))
 for(let i=0;i<waiting.findIndex(v=>v.id===visit.id);i++)checked(await reception.rpc('queue_visit_action',{p_visit_id:visit.id,p_action:'move_up',p_request_id:crypto.randomUUID(),p_reason:'Synthetic connection verification'}))
 const started=performance.now()
 checked(await doctor.rpc('queue_visit_action',{p_visit_id:visit.id,p_action:'call',p_request_id:crypto.randomUUID()}))
 writeFileSync('/private/tmp/clinic-alert-call.json',JSON.stringify(visit))
 console.log('CALLED synthetic token',visit.token_number,'; reception browser should mark Sent in')
 const deadline=Date.now()+180000
 while(Date.now()<deadline){
  if(checked(await doctor.from('visits').select('stage').eq('id',visit.id).single()).stage==='with_doctor')break
  await new Promise(resolve=>setTimeout(resolve,1000))
 }
 assert.equal(checked(await doctor.from('visits').select('stage').eq('id',visit.id).single()).stage,'with_doctor','Reception Sent in must be observed by doctor')
 for(const [role,action] of [['reception','call'],['doctor','sent_in']])assert.ok(events.some(e=>e.role===role&&e.action===action),role+' must receive '+action)
 console.log('PASS: doctor call reaches reception and reception Sent in reaches doctor; call event ms from request',Math.round(events.find(e=>e.role==='reception'&&e.action==='call').at-started))
 console.log('Synthetic token retained for 60 seconds for browser observation')
 await new Promise(resolve=>setTimeout(resolve,60000))
}finally{
 if(visit){checked(await service.from('queue_events').delete().eq('visit_id',visit.id));checked(await service.from('visit_pricing').delete().eq('visit_id',visit.id));checked(await service.from('visits').delete().eq('id',visit.id))}
 if(patient)checked(await service.from('patients').delete().eq('id',patient.id))
 await doctor.removeAllChannels();await reception.removeAllChannels();await doctor.auth.signOut({scope:'local'});await reception.auth.signOut({scope:'local'})
}
process.exit(0)
