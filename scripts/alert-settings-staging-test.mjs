import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import ws from 'ws'
const env=p=>Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')&&l.includes('=')).map(l=>{let i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const app=env('.env.local'),users=env('.env.test-users.local'),clinic='23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co')
const clients=[];const value=r=>{assert.ifError(r.error);return r.data}
async function login(email,password){const c=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:ws}});clients.push(c);value(await c.auth.signInWithPassword({email,password}));return c}
let doctor,previous
try{
 doctor=await login('doctor.a@staging.test',users.TEST_DOCTOR_A_PASSWORD)
 const reception=await login('reception.a@staging.test',users.TEST_RECEPTION_A_PASSWORD)
 previous=value(await doctor.from('clinics').select('called_reminder_minutes,closing_minute').eq('id',clinic).single())
 const args={p_clinic_id:clinic,p_called_reminder_minutes:7,p_closing_minute:975}
 value(await doctor.rpc('set_alert_settings',args));value(await doctor.rpc('set_alert_settings',args))
 assert.deepEqual(value(await reception.from('clinics').select('called_reminder_minutes,closing_minute').eq('id',clinic).single()),{called_reminder_minutes:7,closing_minute:975})
 for(const changes of [{p_called_reminder_minutes:0},{p_called_reminder_minutes:241},{p_closing_minute:-1},{p_closing_minute:1440},{p_closing_minute:null}])assert.ok((await doctor.rpc('set_alert_settings',{...args,...changes})).error)
 assert.ok((await reception.rpc('set_alert_settings',args)).error)
 const other=await login('doctor.b@staging.test',users.TEST_DOCTOR_B_PASSWORD);assert.ok((await other.rpc('set_alert_settings',args)).error)
 const anonymous=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false},realtime:{transport:ws}});assert.ok((await anonymous.rpc('set_alert_settings',args)).error)
 assert.deepEqual(value(await doctor.from('clinics').select('called_reminder_minutes,closing_minute').eq('id',clinic).single()),{called_reminder_minutes:7,closing_minute:975},'invalid/unauthorised updates change nothing')
 console.log('PASS: settings persist across roles, retry safely, reject invalid values and enforce role/clinic/anonymous boundaries')
}finally{
 if(previous)value(await doctor.rpc('set_alert_settings',{p_clinic_id:clinic,p_called_reminder_minutes:previous.called_reminder_minutes,p_closing_minute:previous.closing_minute}))
 await Promise.all(clients.map(c=>c.auth.signOut({scope:'local'})))
}
