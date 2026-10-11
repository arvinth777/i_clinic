import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
const env = path => Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => [l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const app = env('.env.local'), passwords = env('.env.test-users.local')
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname, 'cofnrcgsolluyhghutah.supabase.co', 'Synthetic staging only')
const keys = JSON.parse(execFileSync('supabase', ['projects','api-keys','--project-ref','cofnrcgsolluyhghutah','--output','json'], {encoding:'utf8',stdio:['ignore','pipe','pipe']}))
const serviceKey = keys.find(key => key.name === 'service_role')?.api_key
assert.ok(serviceKey, 'Staging test fixture setup requires CLI access')
const client = key => createClient(app.VITE_SUPABASE_URL,key,{auth:{persistSession:false},realtime:{transport:ws}})
const service = client(serviceKey), anon = client(app.VITE_SUPABASE_ANON_KEY), clients = []
function data(result) { assert.ifError(result.error); return result.data }
async function login(email,password) {const c=client(app.VITE_SUPABASE_ANON_KEY); data(await c.auth.signInWithPassword({email,password}));clients.push(c);return c}
const clinic = '23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
let patientId, fileId
try {
 const doctor = await login('doctor.a@staging.test',passwords.TEST_DOCTOR_A_PASSWORD)
 const reception = await login('reception.a@staging.test',passwords.TEST_RECEPTION_A_PASSWORD)
 const admin = await login('admin.only@staging.test',passwords.TEST_ADMIN_ONLY_PASSWORD)
 const other = await login('doctor.b@staging.test',passwords.TEST_DOCTOR_B_PASSWORD)
 const owner = (await doctor.auth.getSession()).data.session.user.id
 patientId = data(await service.from('patients').insert({clinic_id:clinic,name:'Synthetic Drive access fixture',age:40}).select('id').single()).id
 fileId = crypto.randomUUID()
 data(await service.from('patient_files').insert({id:fileId,clinic_id:clinic,patient_id:patientId,title:'Synthetic scan',category:'X-ray',mime_type:'image/png',size_bytes:10,content_sha256:'a'.repeat(64),drive_file_id:`synthetic-${fileId}`,uploaded_by:owner,status:'ready'}))
 assert.equal(data(await doctor.from('patient_files').select('id').eq('id',fileId)).length,1)
 for (const c of [reception,admin,other]) assert.deepEqual(data(await c.from('patient_files').select('id').eq('id',fileId)),[])
 assert.ok((await anon.from('patient_files').select('id').eq('id',fileId)).error)
 for (const c of [doctor,reception,admin,other,anon]) {
  for (const table of ['clinic_drive_connections','clinic_drive_oauth_states']) assert.ok((await c.from(table).select('*').limit(1)).error)
  assert.ok((await c.from('patient_files').update({title:'forged'}).eq('id',fileId)).error)
  assert.ok((await c.from('patient_files').delete().eq('id',fileId)).error)
 }
 console.log('PASS: hosted doctor read; reception/admin/other clinic/anonymous denied; metadata writes and credential/state reads blocked')
 const call = async(c,clinicId=clinic) => {
  const token = (await c.auth.getSession()).data.session?.access_token ?? app.VITE_SUPABASE_ANON_KEY
  return fetch(`${app.VITE_SUPABASE_URL}/functions/v1/patient-documents?action=status`,{method:'POST',headers:{Authorization:`Bearer ${token}`,apikey:app.VITE_SUPABASE_ANON_KEY,Origin:process.env.CLINIC_APP_ORIGIN??'http://127.0.0.1:5192','Content-Type':'application/json'},body:JSON.stringify({clinic_id:clinicId})})
 }
 const status = await call(doctor); assert.equal(status.status,200); const result=await status.json();assert.equal(typeof result.configured,'boolean');if(!result.configured)assert.equal(result.connected,false)
 for(const c of [reception,admin,other])assert.equal((await call(c)).status,403)
 assert.equal((await call(anon)).status,401)
 console.log('PASS: hosted endpoint validates roles and reports actual connection/setup status')
} finally {
 if(fileId)data(await service.from('patient_files').delete().eq('id',fileId))
 if(patientId)data(await service.from('patients').delete().eq('id',patientId))
 for(const c of clients){await c.auth.signOut({scope:'local'});c.realtime.disconnect()}
 service.realtime.disconnect();anon.realtime.disconnect()
}
