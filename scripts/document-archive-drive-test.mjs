import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import ws from 'ws'
const env=p=>Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const app=env('.env.local'),pw=env('.env.test-users.local'),clinic='23e03361-9d6c-49f5-83b7-ad57f4a0c5ce',clients=[]
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co')
async function login(email,password){const c=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:ws}});const result=await c.auth.signInWithPassword({email,password});assert.ifError(result.error);clients.push(c);return c}
async function request(client,action,body){const token=(await client.auth.getSession()).data.session.access_token;return fetch(`${app.VITE_SUPABASE_URL}/functions/v1/patient-documents?action=${action}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,apikey:app.VITE_SUPABASE_ANON_KEY,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)})}
try{
 const doctor=await login('doctor.a@staging.test',pw.TEST_DOCTOR_A_PASSWORD)
 if(process.argv[2]==='prepare'){
  const kind=process.argv[3]??'prescription'
  const {data,error}=await doctor.from('document_archives').select('id,kind,snapshot').eq('clinic_id',clinic).eq('kind',kind).eq('status','pending').order('created_at',{ascending:false}).limit(1).single();assert.ifError(error)
  assert.match(data.snapshot.visit?.patients?.name??data.snapshot.customerName,/^SYNTHETIC /,'never export production/unspecified patient data')
  writeFileSync('archive-staging-fixture.json',JSON.stringify({...data,clinic_id:clinic}))
  console.log('PASS: synthetic staging issued snapshot prepared locally; no credentials exported')
 }else{
  const job=JSON.parse(readFileSync('archive-staging-fixture.json','utf8')),bytes=readFileSync(process.argv[3])
  const reception=await login('reception.a@staging.test',pw.TEST_RECEPTION_A_PASSWORD)
  const form=()=>{const f=new FormData();f.set('metadata',JSON.stringify({id:job.id,clinic_id:clinic}));f.set('file',new Blob([bytes],{type:'application/pdf'}),'archive.pdf');return f}
  const forbidden=job.kind==='prescription'?await request(reception,'archive-upload',form()):await request(reception,'status',{clinic_id:clinic});assert.equal(forbidden.status,403,'reception has no clinical/connection access')
  const client=job.kind==='receipt'?reception:doctor
  const upload=await request(client,'archive-upload',form());assert.equal(upload.status,200,await upload.text())
  const before=await doctor.from('document_archives').select('id,status,drive_file_id,content_sha256,size_bytes').eq('id',job.id).single();assert.ifError(before.error);assert.equal(before.data.status,'ready')
  assert.equal((await request(client,'archive-upload',form())).status,200)
  const after=await doctor.from('document_archives').select('id,status,drive_file_id,content_sha256,size_bytes').eq('id',job.id).single();assert.ifError(after.error);assert.deepEqual(after.data,before.data,'retry leaves stable Drive identity/content')
  const download=await request(client,'archive-content',{id:job.id,clinic_id:clinic});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes)
  if(job.kind==='prescription')assert.equal((await request(reception,'archive-content',{id:job.id,clinic_id:clinic})).status,403)
  console.log('PASS: live staging Drive PDF upload, stable retry, byte-exact private download and reception permission boundary')
 }
}finally{await Promise.all(clients.map(c=>c.auth.signOut({scope:'local'})))}
