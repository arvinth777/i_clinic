import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
const env=p=>Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const app=env('.env.local'), passwords=env('.env.test-users.local')
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co','Synthetic staging only')
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref','cofnrcgsolluyhghutah','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))
const client=key=>createClient(app.VITE_SUPABASE_URL,key,{auth:{persistSession:false},realtime:{transport:ws}})
const doctor=client(app.VITE_SUPABASE_ANON_KEY), service=client(keys.find(k=>k.name==='service_role').api_key)
const checked=r=>{assert.ifError(r.error);return r.data}
const session=checked(await doctor.auth.signInWithPassword({email:'doctor.a@staging.test',password:passwords.TEST_DOCTOR_A_PASSWORD})).session
const clinic='23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
const origin='https://iclinic-1jplfzbwe-arvinth777s-projects.vercel.app'
async function call(action,body){return fetch(app.VITE_SUPABASE_URL+'/functions/v1/patient-documents?action='+action,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:app.VITE_SUPABASE_ANON_KEY,Origin:origin,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)})}
try{
 const status=await call('status',{clinic_id:clinic});assert.equal(status.status,200);assert.equal((await status.json()).connected,true)
 const patient=checked(await service.from('patients').insert({clinic_id:clinic,name:'SYNTHETIC Drive connection verification',age:40}).select('id').single()).id
 const fixtures=[{name:'PNG',type:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=','base64')},{name:'PDF',type:'application/pdf',bytes:readFileSync('docs/evidence/ui-handoff/short.pdf')}]
 const ids=[]
 for(const f of fixtures){
  const id=crypto.randomUUID(),meta={id,clinic_id:clinic,patient_id:patient,title:'Synthetic '+f.name+' verification',category:'Other',examination_date:null,note:'Synthetic test only; no patient data.'}
  const form=new FormData();form.set('metadata',JSON.stringify(meta));form.set('file',new Blob([f.bytes],{type:f.type}),'synthetic.'+f.name.toLowerCase())
  for(let i=0;i<2;i++){const r=await call('upload',form);assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).id,id)}
  const rows=checked(await doctor.from('patient_files').select('id,status').eq('id',id));assert.equal(rows.length,1);assert.equal(rows[0].status,'ready')
  const r=await call('content',{clinic_id:clinic,patient_id:patient,id});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),f.type);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),createHash('sha256').update(f.bytes).digest('hex'))
  const link=await call('link',{clinic_id:clinic,patient_id:patient,id});assert.equal(link.status,200);assert.equal(new URL((await link.json()).url).origin,'https://drive.google.com')
  ids.push(id);console.log('PASS: actual Drive '+f.name+' upload, duplicate retry, checksum download and private link')
 }
 writeFileSync('/private/tmp/clinic-drive-live-evidence.json',JSON.stringify({patientId:patient,fileIds:ids,synthetic:true},null,2))
 console.log('Synthetic verification documents retained for browser preview checks')
}finally{await doctor.auth.signOut({scope:'local'})}
process.exit(0)
