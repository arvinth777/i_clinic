import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import ws from 'ws'
const env=path=>Object.fromEntries(readFileSync(path,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const app=env('.env.local'),passwords=env('.env.test-users.local'),clinicId='23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co')
const clients=[];function value(r){assert.ifError(r.error);return r.data}
async function login(role,password){const c=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false},realtime:{transport:ws}});value(await c.auth.signInWithPassword({email:`${role}.a@staging.test`,password}));clients.push(c);return c}
try{
 const doctor=await login('doctor',passwords.TEST_DOCTOR_A_PASSWORD),reception=await login('reception',passwords.TEST_RECEPTION_A_PASSWORD)
 const patient=value(await reception.from('patients').insert({clinic_id:clinicId,name:`Partial supply synthetic ${crypto.randomUUID()}`,age:40}).select('id').single())
 const medicine=value(await doctor.from('medicines').insert({clinic_id:clinicId,name:`Partial supply tablets ${crypto.randomUUID()}`,price_paise:1000}).select('id').single())
 value(await reception.rpc('set_medicine_unit_price',{p_medicine_id:medicine.id,p_stock_unit:'tablet',p_price_paise:1000}))
 const counter=value(await reception.from('stock_points').select('id').eq('clinic_id',clinicId).eq('name','Counter').single()).id
 const adjust=qty=>reception.rpc('adjust_stock',{p_clinic_id:clinicId,p_medicine_id:medicine.id,p_stock_point_id:counter,p_quantity_delta:qty,p_reason:'Synthetic dispensing regression'})
 value(await adjust(5))
 async function ready(discount=5000){
  const visit=value(await reception.from('visits').insert({clinic_id:clinicId,patient_id:patient.id,arrived_at:new Date().toISOString(),complaint:'Synthetic supply test'}).select('id').single())
  const itemId=crypto.randomUUID()
  value(await doctor.rpc('save_prescription',{p_prescription_id:crypto.randomUUID(),p_visit_id:visit.id,p_items:[{id:itemId,medicine_id:medicine.id,dosage_frequency:'1-0-1',duration_days:5,quantity_dispensed:10}]}))
  const proposal=value(await doctor.rpc('get_pricing_proposal',{p_visit_id:visit.id}))
  const revision=value(await doctor.rpc('approve_visit_pricing',{p_visit_id:visit.id,p_final_amount_paise:35000-discount,p_expected_total_paise:35000,p_expected_revision_number:proposal.revision_number,p_request_id:crypto.randomUUID()}))
  const command=(client,action)=>client.rpc('queue_visit_action',{p_visit_id:visit.id,p_action:action,p_request_id:crypto.randomUUID()})
  const today=new Date();today.setHours(0,0,0,0)
  const waiting=value(await reception.from('visits').select('id').eq('clinic_id',clinicId).eq('stage','waiting').gte('arrived_at',today.toISOString()).order('queue_position'))
  for(let i=0;i<waiting.findIndex(v=>v.id===visit.id);i++)value(await command(reception,'move_up'))
  value(await command(doctor,'call'));value(await command(reception,'sent_in'));value(await command(doctor,'finish'))
  return {visitId:visit.id,itemId,revision,amount:35000-discount}
 }
 const first=await ready()
 const request={p_visit_id:first.visitId,p_request_id:crypto.randomUUID()}
 assert.ok((await doctor.rpc('request_bill_discount',request)).error,'only reception requests a discount')
 value(await reception.rpc('request_bill_discount',request));value(await reception.rpc('request_bill_discount',request))
 assert.equal(value(await reception.from('queue_events').select('request_id').eq('request_id',request.p_request_id)).length,1)
 const refreshed=value(await doctor.rpc('get_pricing_proposal',{p_visit_id:first.visitId}))
 first.revision=value(await doctor.rpc('approve_visit_pricing',{p_visit_id:first.visitId,p_final_amount_paise:first.amount,p_expected_total_paise:refreshed.total_paise,p_expected_revision_number:refreshed.revision_number,p_request_id:crypto.randomUUID()}))
 assert.equal(value(await reception.from('visits').select('discount_requested_at').eq('id',first.visitId).single()).discount_requested_at,null)
 const pay=(v,qty,client=reception)=>client.rpc('confirm_bill',{p_visit_id:v.visitId,p_payment_method:'cash',p_snapshot_final_amount_paise:v.amount,p_snapshot_revision_number:v.revision,p_supplied_items:[{prescription_item_id:v.itemId,quantity:qty}]})
 assert.ok((await pay(first,11)).error,'no oversupply')
 assert.ok((await pay(first,6)).error,'no supply beyond available stock')
 assert.ok((await pay(first,3,doctor)).error,'doctor cannot confirm reception payment')
 const paid=await Promise.all([pay(first,3),pay(first,3)])
 const billId=value(paid[0]);assert.equal(value(paid[1]),billId)
 const bill=value(await reception.from('bills').select('final_amount_paise,approved_discount_paise,bill_line_items(quantity,approved_quantity,shortfall,kind)').eq('id',billId).single())
 assert.equal(bill.final_amount_paise,23000,'₹250 consultation + 3 × ₹10 − ₹50')
 assert.equal(bill.approved_discount_paise,5000)
 assert.deepEqual(bill.bill_line_items.find(l=>l.kind==='medicine'),{kind:'medicine',quantity:3,approved_quantity:10,shortfall:7})
 assert.deepEqual(value(await reception.from('stock_movements').select('quantity_delta').eq('reference_id',first.itemId)),[{quantity_delta:-3}])
 assert.equal(value(await pay(first,9)),billId,'changed retry cannot mutate an already paid bill')
 console.log('PASS: partial quantity, fixed discount, immutable shortfall, role checks and one atomic deduction')
 value(await doctor.from('visit_pricing').update({final_amount_paise:31000}).eq('visit_id',first.visitId))
 assert.ok((await reception.rpc('correct_bill',{p_bill_id:billId})).error)
 assert.equal(value(await doctor.from('bills_needing_reconciliation').select('live_final_amount_paise').eq('id',billId).single()).live_final_amount_paise,24000,'correction proposal uses supplied subtotal')
 assert.ok((await doctor.rpc('correct_bill',{p_bill_id:billId,p_expected_amount_paise:31000})).error,'changed correction proposal must be reviewed')
 const correction=value(await doctor.rpc('correct_bill',{p_bill_id:billId,p_expected_amount_paise:24000}))
 assert.equal(value(await doctor.rpc('correct_bill',{p_bill_id:billId,p_expected_amount_paise:24000})),correction)
 const corrected=value(await doctor.from('bills').select('final_amount_paise,approved_discount_paise,bill_line_items(quantity,approved_quantity,shortfall,kind)').eq('id',correction).single())
 assert.equal(corrected.final_amount_paise,24000,'correction applies revised discount to actual supplied subtotal')
 assert.equal(corrected.approved_discount_paise,4000)
 assert.deepEqual(corrected.bill_line_items.find(l=>l.kind==='medicine'),{kind:'medicine',quantity:3,approved_quantity:10,shortfall:7})
 assert.equal(value(await reception.from('stock_movements').select('id').eq('reference_id',first.itemId)).length,1,'correction does not dispense again')
 console.log('PASS: discount request acknowledgement and immutable correction preserve shortfalls')
 const capped=await ready(30000)
 const cappedId=value(await pay(capped,0))
 assert.equal(value(await reception.from('bills').select('final_amount_paise,approved_discount_paise').eq('id',cappedId).single()).final_amount_paise,0,'discount capped at consultation-only subtotal')
 assert.equal(value(await reception.from('stock_movements').select('id').eq('reference_id',capped.itemId)).length,0,'zero supply does not deduct stock')
 console.log('PASS: zero supply and capped discount preserve the original doctor discount')
 const left=await ready(),right=await ready()
 const race=await Promise.all([pay(left,2),pay(right,2)])
 assert.equal(race.filter(r=>!r.error).length,1,'only one concurrent bill can take the last two units')
 assert.equal(value(await reception.from('medicine_stock').select('quantity').eq('medicine_id',medicine.id).eq('stock_point_id',counter).single()).quantity,0)
 console.log('PASS: concurrent bills cannot oversell the final stock')
}finally{await Promise.all(clients.map(c=>c.auth.signOut()))}
