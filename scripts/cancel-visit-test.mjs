// Cancel visit: the doctor or the receptionist can close any unpaid visit with a reason; paid visits cannot be cancelled.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import ws from 'ws'
import {checked,payVisit} from './clinic-workflow-fixture.mjs'
const env=p=>Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')&&l.includes('=')).map(l=>{let i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const app=env('.env.local'),users=env('.env.test-users.local'),clinic='23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co','staging only')
const mk=async(e,p)=>{const c=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false},realtime:{transport:ws}});if(e)checked(await c.auth.signInWithPassword({email:e,password:p}));return c}
const doctor=await mk('doctor.a@staging.test',users.TEST_DOCTOR_A_PASSWORD),reception=await mk('reception.a@staging.test',users.TEST_RECEPTION_A_PASSWORD)
const otherDoctor=await mk('doctor.b@staging.test',users.TEST_DOCTOR_B_PASSWORD),anon=await mk()
const act=(who,id,action,reason)=>who.rpc('queue_visit_action',{p_visit_id:id,p_action:action,p_request_id:crypto.randomUUID(),p_reason:reason??null})
const midnight=new Date();midnight.setHours(0,0,0,0)
const newVisit=async(procedure)=>{
 const patient=checked(await reception.from('patients').insert({clinic_id:clinic,name:`Cancel test ${crypto.randomUUID()}`,age:40}).select('id').single())
 const visit=checked(await reception.from('visits').insert({clinic_id:clinic,patient_id:patient.id,arrived_at:new Date().toISOString(),complaint:'Synthetic cancel test'}).select('id').single())
 if(procedure){const p=checked(await doctor.from('procedures').insert({clinic_id:clinic,name:`TEST ONLY cancel ${crypto.randomUUID()}`,default_price_paise:10000}).select('id').single());checked(await doctor.from('visit_procedures').insert({clinic_id:clinic,visit_id:visit.id,procedure_id:p.id,price_paise:10000}))}
 return visit.id}
const toFront=async id=>{const w=checked(await reception.from('visits').select('id').eq('clinic_id',clinic).eq('stage','waiting').gte('arrived_at',midnight.toISOString()).order('queue_position'));for(let i=0;i<w.findIndex(v=>v.id===id);i++)checked(await act(reception,id,'move_up'))}
const stage=async id=>checked(await doctor.from('visits').select('stage,closed_at').eq('id',id).single())
try{
 // waiting: reception cancels; a reason is required; anonymous and another clinic's doctor are refused
 const waiting=await newVisit()
 assert.ok((await act(reception,waiting,'cancel')).error,'a reason is required')
 assert.ok((await act(reception,waiting,'cancel','   ')).error,'a blank reason is refused')
 assert.ok((await act(anon,waiting,'cancel','nope')).error,'anonymous refused')
 assert.ok((await act(otherDoctor,waiting,'cancel','nope')).error,'another clinic refused')
 checked(await act(reception,waiting,'cancel','Registered by mistake'))
 const closed=await stage(waiting);assert.equal(closed.stage,'cancelled');assert.ok(closed.closed_at)
 assert.ok((await act(reception,waiting,'move_up')).error,'a cancelled visit cannot be moved')
 assert.equal(checked(await doctor.from('queue_events').select('reason,action').eq('visit_id',waiting).eq('action','cancel').single()).reason,'Registered by mistake')
 // with doctor: the doctor cancels
 const inRoom=await newVisit();await toFront(inRoom);checked(await act(doctor,inRoom,'call'));checked(await act(reception,inRoom,'sent_in'))
 checked(await act(doctor,inRoom,'cancel','Left without treatment'));assert.equal((await stage(inRoom)).stage,'cancelled')
 // ready to bill: either role; no bill, no stock movement
 const ready=await newVisit(true);await toFront(ready);checked(await act(doctor,ready,'call'));checked(await act(reception,ready,'sent_in'));checked(await act(doctor,ready,'finish'))
 checked(await act(reception,ready,'cancel','Patient could not pay today'));assert.equal((await stage(ready)).stage,'cancelled')
 assert.equal(checked(await reception.from('bills').select('id').eq('visit_id',ready)).length,0,'no bill')
 assert.ok((await reception.rpc('confirm_reception_bill',{p_visit_id:ready,p_payment_method:'cash',p_expected_total_paise:0,p_items:[]})).error,'a cancelled visit cannot be billed')
 // paid: cannot be cancelled
 const paid=await newVisit(true);await toFront(paid);checked(await act(doctor,paid,'call'));checked(await act(reception,paid,'sent_in'));checked(await act(doctor,paid,'finish'))
 await payVisit(reception,paid)
 assert.ok((await act(doctor,paid,'cancel','too late')).error,'a paid visit cannot be cancelled');assert.equal((await stage(paid)).stage,'paid')
 console.log('PASS: either role cancels any unpaid visit with a reason; no bill; paid visits cannot be cancelled; outsiders refused')
}finally{await Promise.all([doctor,reception,otherDoctor].map(c=>c.auth.signOut({scope:'local'})))}
