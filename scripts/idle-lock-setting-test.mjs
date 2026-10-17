import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import ws from 'ws'
const env=p=>Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')&&l.includes('=')).map(l=>{let i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const app=env('.env.local'),users=env('.env.test-users.local'),clinic='23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co')
const clients=[];const value=r=>{assert.ifError(r.error);return r.data}
async function login(email,password){const c=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:ws}});clients.push(c);value(await c.auth.signInWithPassword({email,password}));return c}
const flag=async c=>value(await c.from('clinics').select('idle_lock_enabled').eq('id',clinic).single()).idle_lock_enabled
let doctor,previous
try{
 doctor=await login('doctor.a@staging.test',users.TEST_DOCTOR_A_PASSWORD)
 const reception=await login('reception.a@staging.test',users.TEST_RECEPTION_A_PASSWORD)
 previous=await flag(doctor)
 value(await doctor.rpc('set_idle_lock',{p_clinic_id:clinic,p_enabled:false}));value(await doctor.rpc('set_idle_lock',{p_clinic_id:clinic,p_enabled:false}))
 assert.equal(await flag(reception),false,'reception sees the clinic-wide switch')
 const on={p_clinic_id:clinic,p_enabled:true}
 assert.ok((await doctor.rpc('set_idle_lock',{...on,p_enabled:null})).error)
 assert.ok((await reception.rpc('set_idle_lock',on)).error)
 const other=await login('doctor.b@staging.test',users.TEST_DOCTOR_B_PASSWORD);assert.ok((await other.rpc('set_idle_lock',on)).error)
 const anonymous=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false},realtime:{transport:ws}});assert.ok((await anonymous.rpc('set_idle_lock',on)).error)
 assert.equal(await flag(doctor),false,'rejected calls change nothing')
 value(await doctor.rpc('set_idle_lock',on));assert.equal(await flag(reception),true)
 console.log('PASS: idle-lock switch persists, retries safely, and only a doctor/admin of the clinic can change it')
}finally{
 if(previous!==undefined)value(await doctor.rpc('set_idle_lock',{p_clinic_id:clinic,p_enabled:previous}))
 await Promise.all(clients.map(c=>c.auth.signOut({scope:'local'})))
}
