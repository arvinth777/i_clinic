// Public approval and catalog boundaries; synthetic staging only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
const env=path=>Object.fromEntries(readFileSync(path,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const app=env('.env.local'), passwords=env('.env.test-users.local'), clinicId='23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co')
const clients=[]
async function login(role,password){const c=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false},realtime:{transport:ws}});assert.ifError((await c.auth.signInWithPassword({email:`${role}.a@staging.test`,password})).error);clients.push(c);return c}
function value(r){assert.ifError(r.error);return r.data}
try{
 const doctor=await login('doctor',passwords.TEST_DOCTOR_A_PASSWORD), reception=await login('reception',passwords.TEST_RECEPTION_A_PASSWORD)
 const patient=value(await reception.from('patients').insert({clinic_id:clinicId,name:`Approval synthetic ${crypto.randomUUID()}`,age:40}).select('id').single())
 const visit=value(await reception.from('visits').insert({clinic_id:clinicId,patient_id:patient.id,arrived_at:new Date().toISOString(),complaint:'Synthetic approval check'}).select('id').single())
 const medicine=value(await doctor.from('medicines').insert({clinic_id:clinicId,name:`Approval tablets ${crypto.randomUUID()}`,price_paise:1000}).select('id').single())
 const price=p=>reception.rpc('set_medicine_unit_price',{p_medicine_id:medicine.id,p_stock_unit:'tablet',p_price_paise:p})
 value(await price(1000))
 const itemId=crypto.randomUUID()
 value(await doctor.rpc('save_prescription',{p_prescription_id:crypto.randomUUID(),p_visit_id:visit.id,p_items:[{id:itemId,medicine_id:medicine.id,dosage_frequency:'1-0-1',duration_days:5,quantity_dispensed:10}]}))
 value(await price(1250))
 const proposal=value(await doctor.rpc('get_pricing_proposal',{p_visit_id:visit.id}))
 assert.equal(proposal.total_paise,37500,'approval uses ₹12.50 × 10 plus ₹250, not earlier prescription price')
 const args={p_visit_id:visit.id,p_final_amount_paise:32500,p_expected_total_paise:37500,p_expected_revision_number:proposal.revision_number,p_request_id:crypto.randomUUID()}
 assert.ok((await reception.rpc('approve_visit_pricing',args)).error)
 const revision=value(await doctor.rpc('approve_visit_pricing',args))
 assert.equal(value(await doctor.rpc('approve_visit_pricing',args)),revision,'approval retry does not create a revision')
 value(await price(2000))
 assert.deepEqual(value(await reception.from('pricing_approvals').select('lines').eq('visit_id',visit.id)),[],'reception cannot read clinical snapshots before handoff')
 const approval=value(await doctor.from('pricing_approvals').select('lines,discount_paise,approved_by').eq('visit_id',visit.id).eq('revision_number',revision).single())
 assert.equal(approval.lines.find(l=>l.kind==='medicine').unit_price_paise,1250,'later catalog edit does not change approval')
 assert.equal(approval.discount_paise,5000)
 assert.ok(approval.approved_by)
 const audit=value(await reception.from('medicine_price_changes').select('old_price_paise,new_price_paise,changed_by,changed_at').eq('medicine_id',medicine.id).order('changed_at'))
 assert.ok(audit.some(a=>a.old_price_paise===1000&&a.new_price_paise===1250&&a.changed_by&&a.changed_at))
 assert.ok((await reception.from('medicine_price_changes').update({new_price_paise:1}).eq('medicine_id',medicine.id)).error)
 console.log('PASS: approval-time unit prices, fixed discount, doctor-only approval, idempotent retries and immutable catalog audit')
}finally{await Promise.all(clients.map(c=>c.auth.signOut()))}
