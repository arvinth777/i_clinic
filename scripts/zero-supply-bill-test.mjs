// A prescribed medicine that cannot be supplied can be billed at 0 units without choosing a stocked product.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import ws from 'ws'
import {checked,consultationOnlyFixture} from './clinic-workflow-fixture.mjs'
const env=p=>Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')&&l.includes('=')).map(l=>{let i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const app=env('.env.local'),users=env('.env.test-users.local'),clinic='23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co','staging only')
const mk=async(e,p)=>{const c=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false},realtime:{transport:ws}});checked(await c.auth.signInWithPassword({email:e,password:p}));return c}
const doctor=await mk('doctor.a@staging.test',users.TEST_DOCTOR_A_PASSWORD),reception=await mk('reception.a@staging.test',users.TEST_RECEPTION_A_PASSWORD)
try{
 const patient=checked(await reception.from('patients').insert({clinic_id:clinic,name:`Zero supply ${crypto.randomUUID()}`,age:40}).select('id').single())
 const visit=checked(await reception.from('visits').insert({clinic_id:clinic,patient_id:patient.id,arrived_at:new Date().toISOString(),complaint:'Synthetic zero supply'}).select('id').single())
 await consultationOnlyFixture(doctor,reception,clinic,visit.id)
 const plan=checked(await reception.rpc('get_reception_bill',{p_visit_id:visit.id}))
 const item={prescription_item_id:plan.medicines[0].prescription_item_id,unit_price_paise:0}
 const bill=(quantity,total=plan.consultation_charge_paise)=>reception.rpc('confirm_reception_bill',{p_visit_id:visit.id,p_payment_method:'cash',p_expected_total_paise:total,p_items:[{...item,quantity}]})
 assert.ok((await bill(1)).error,'supplying a unit still needs a stocked product')
 const id=checked(await bill(0))
 const lines=checked(await reception.from('bill_line_items').select('kind,quantity').eq('bill_id',id))
 assert.equal(lines.find(l=>l.kind==='medicine').quantity,0,'the unsupplied line is kept at 0')
 assert.equal(checked(await reception.from('stock_movements').select('id').eq('reference_id',item.prescription_item_id).eq('reason','dispensed')).length,0,'no stock deducted')
 console.log('PASS: a medicine billed at 0 units needs no stocked product; supplying units still does')
}finally{await doctor.auth.signOut({scope:'local'});await reception.auth.signOut({scope:'local'})}
