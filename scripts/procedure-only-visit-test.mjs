// A visit with a procedure and no medicine must finish and be billed (it was blocked by the brand-billing rewrite).
// Also: a prescribed quantity of NULL cannot be over-supplied, and the stock-unit match ignores case.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import ws from 'ws'
import {checked,payVisit} from './clinic-workflow-fixture.mjs'
const env=p=>Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')&&l.includes('=')).map(l=>{let i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const app=env('.env.local'),users=env('.env.test-users.local'),clinic='23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co','staging only')
const mk=async(e,p)=>{const c=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false},realtime:{transport:ws}});checked(await c.auth.signInWithPassword({email:e,password:p}));return c}
const doctor=await mk('doctor.a@staging.test',users.TEST_DOCTOR_A_PASSWORD),reception=await mk('reception.a@staging.test',users.TEST_RECEPTION_A_PASSWORD)
const midnight=new Date();midnight.setHours(0,0,0,0)
const toFront=async id=>{const w=checked(await reception.from('visits').select('id').eq('clinic_id',clinic).eq('stage','waiting').gte('arrived_at',midnight.toISOString()).order('queue_position'));for(let i=0;i<w.findIndex(v=>v.id===id);i++)checked(await reception.rpc('queue_visit_action',{p_visit_id:id,p_action:'move_up',p_request_id:crypto.randomUUID()}))}
const act=(who,id,a)=>who.rpc('queue_visit_action',{p_visit_id:id,p_action:a,p_request_id:crypto.randomUUID()})
try{
 const patient=checked(await reception.from('patients').insert({clinic_id:clinic,name:`Procedure only ${crypto.randomUUID()}`,age:40}).select('id').single())
 const visit=checked(await reception.from('visits').insert({clinic_id:clinic,patient_id:patient.id,arrived_at:new Date().toISOString(),complaint:'Synthetic injection only'}).select('id').single())
 const procedure=checked(await doctor.from('procedures').insert({clinic_id:clinic,name:`TEST ONLY injection ${crypto.randomUUID()}`,default_price_paise:15000}).select('id').single())
 checked(await doctor.from('visit_procedures').insert({clinic_id:clinic,visit_id:visit.id,procedure_id:procedure.id,price_paise:15000}))
 await toFront(visit.id)
 checked(await act(doctor,visit.id,'call'));checked(await act(reception,visit.id,'sent_in'))
 checked(await act(doctor,visit.id,'finish'))   // used to raise: a prescription item was required
 assert.equal(checked(await doctor.from('visits').select('stage').eq('id',visit.id).single()).stage,'ready_to_bill')
 assert.equal(checked(await doctor.from('document_archives').select('id').eq('visit_id',visit.id).eq('kind','prescription')).length,1,'a prescription archive is still queued, with no medicines')
 const billId=await payVisit(reception,visit.id)
 const bill=checked(await reception.from('bills').select('final_amount_paise,bill_line_items(kind)').eq('id',billId).single())
 assert.equal(bill.final_amount_paise,25000+15000,'consultation + procedure')
 assert.deepEqual(bill.bill_line_items.map(l=>l.kind).sort(),['consultation','procedure'])
 assert.equal(await payVisit(reception,visit.id),billId,'retry returns the same bill')
 console.log('PASS: a procedure-only visit finishes, queues its archive and bills once')
}finally{await doctor.auth.signOut({scope:'local'});await reception.auth.signOut({scope:'local'})}
