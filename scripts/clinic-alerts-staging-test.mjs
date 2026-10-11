import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import ws from 'ws'
const env=p=>Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const app=env('.env.local'), passwords=env('.env.test-users.local')
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co')
const clinic='23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
const checked=r=>{assert.ifError(r.error);return r.data}
const clients=[]
try{
 for(const [email,key,clinical] of [['doctor.a@staging.test','TEST_DOCTOR_A_PASSWORD',true],['reception.a@staging.test','TEST_RECEPTION_A_PASSWORD',true],['admin.only@staging.test','TEST_ADMIN_ONLY_PASSWORD',false],['doctor.b@staging.test','TEST_DOCTOR_B_PASSWORD',false]]){
  const c=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false},realtime:{transport:ws}});clients.push(c)
  checked(await c.auth.signInWithPassword({email,password:passwords[key]}))
  for(const [table,fields] of [['visits','id,patient_id,token_number,stage,arrived_at,called_at,not_here_at,discount_requested_at'],['medicines','id,name,low_stock_threshold,expiry_date'],['medicine_stock','medicine_id,quantity']]){
   const result=await c.from(table).select(fields).eq('clinic_id',clinic).limit(500)
   if(clinical || email==='admin.only@staging.test' && table!=='visits')checked(result);else assert.ok(result.error||result.data.length===0,table+' leaked into another role/clinic')
  }
  if(email==='doctor.a@staging.test')checked(await c.from('bill_line_items').select('bill_id,shortfall,bills!inner(visit_id,confirmed_at,visits(patient_id,token_number))').eq('clinic_id',clinic).gt('shortfall',0).limit(500))
  if(clinical)checked(await c.from('clinics').select('no_show_minutes').eq('id',clinic).single())
 }
 console.log('PASS: hosted alert queries work for doctor/reception; admin-only clinical visits and other-clinic data access denied; doctor shortfall joins work')
}finally{for(const c of clients)await c.auth.signOut({scope:'local'})}
process.exit(0)
