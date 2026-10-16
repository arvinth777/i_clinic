import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import ws from 'ws'
import {checked,consultationOnlyFixture} from './clinic-workflow-fixture.mjs'
const env=p=>Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const app=env('.env.local'),pw=env('.env.test-users.local'),clinic='23e03361-9d6c-49f5-83b7-ad57f4a0c5ce',clients=[]
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co')
async function login(email,password){const c=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:ws}});checked(await c.auth.signInWithPassword({email,password}));clients.push(c);return c}
try{
 const doctor=await login('doctor.a@staging.test',pw.TEST_DOCTOR_A_PASSWORD),reception=await login('reception.a@staging.test',pw.TEST_RECEPTION_A_PASSWORD)
 checked(await doctor.from('document_archives').select('id').limit(0))
 async function visit(){const p=checked(await reception.from('patients').insert({clinic_id:clinic,name:'SYNTHETIC archive '+crypto.randomUUID(),age:40}).select('id').single());return checked(await reception.from('visits').insert({clinic_id:clinic,patient_id:p.id,arrived_at:new Date().toISOString(),complaint:'Synthetic archive complaint'}).select('id').single()).id}
 const id=await visit();await consultationOnlyFixture(doctor,reception,clinic,id,25000)
 const rx=checked(await doctor.from('document_archives').select('id,kind,snapshot,source_id,source_version').eq('visit_id',id).eq('kind','prescription').single())
 assert.equal(rx.source_id,id);assert.equal(rx.snapshot.kind,'prescription');assert.ok(rx.snapshot.medicines.length)
 assert.equal(checked(await reception.from('document_archives').select('id').eq('id',rx.id)).length,0,'reception never reads clinical archive snapshots')
 const billId=checked(await reception.rpc('confirm_bill',{p_visit_id:id,p_payment_method:'cash'}));assert.equal(checked(await reception.rpc('confirm_bill',{p_visit_id:id,p_payment_method:'cash'})),billId)
 const receipt=checked(await reception.from('document_archives').select('id,snapshot').eq('bill_id',billId).single());assert.equal(receipt.snapshot.amountPaise,25000)
 assert.ok(!JSON.stringify(receipt.snapshot).includes('dosage_frequency'),'receipt snapshot excludes clinical instructions')
 assert.equal(checked(await reception.from('document_archives').select('id').eq('bill_id',billId)).length,1)
 assert.ok((await reception.from('document_archives').update({status:'ready'}).eq('id',receipt.id)).error,'client cannot forge upload completion')
 checked(await doctor.from('visit_pricing').update({final_amount_paise:20000}).eq('visit_id',id))
 const correction=checked(await doctor.rpc('correct_bill',{p_bill_id:billId}));const corrected=checked(await reception.from('document_archives').select('id,snapshot').eq('bill_id',correction).single());assert.notEqual(corrected.id,receipt.id);assert.equal(corrected.snapshot.correctsBillId,billId)
 assert.equal(checked(await reception.from('document_archives').select('snapshot').eq('id',receipt.id).single()).snapshot.amountPaise,25000,'original archive stays immutable')
 const credit=await visit();await consultationOnlyFixture(doctor,reception,clinic,credit,25000);const creditBill=checked(await reception.rpc('confirm_bill',{p_visit_id:credit,p_payment_method:'pay_later'}));assert.equal(checked(await reception.from('document_archives').select('id').eq('bill_id',creditBill)).length,0,'no paid receipt before settlement')
 checked(await reception.rpc('settle_bill',{p_bill_id:creditBill,p_payment_method:'upi',p_notes:null}));assert.equal(checked(await reception.from('document_archives').select('snapshot').eq('bill_id',creditBill).single()).snapshot.bill.payment_method,'upi')
 const med=checked(await doctor.from('medicines').insert({clinic_id:clinic,name:'SYNTHETIC pharmacy archive '+crypto.randomUUID(),price_paise:1000}).select('id').single())
 checked(await reception.rpc('set_medicine_unit_price',{p_medicine_id:med.id,p_stock_unit:'tablet',p_price_paise:1000}))
 const counter=checked(await reception.from('stock_points').select('id').eq('clinic_id',clinic).eq('name','Counter').single()).id
 checked(await reception.rpc('adjust_stock',{p_clinic_id:clinic,p_medicine_id:med.id,p_stock_point_id:counter,p_quantity_delta:3,p_reason:'Synthetic archive fixture'}))
 const sale=crypto.randomUUID();checked(await reception.rpc('save_pharmacy_sale',{p_sale_id:sale,p_clinic_id:clinic,p_customer_name:'SYNTHETIC name-only archive',p_items:[{medicine_id:med.id,quantity:3,unit_price_paise:1000,stock_unit:'tablet'}]}))
 const pharma=checked(await reception.rpc('confirm_pharmacy_sale',{p_sale_id:sale,p_payment_method:'cash',p_expected_amount_paise:3000}))
 const pharmaReceipt=checked(await reception.from('document_archives').select('visit_id,snapshot').eq('bill_id',pharma).single())
 assert.equal(pharmaReceipt.visit_id,null);assert.equal(pharmaReceipt.snapshot.visit,null);assert.equal(pharmaReceipt.snapshot.customerName,'SYNTHETIC name-only archive');assert.equal(pharmaReceipt.snapshot.amountPaise,3000)
 assert.ok(pharmaReceipt.snapshot.billable.every(line=>line.kind!=='consultation'),'name-only receipt has no consultation')
 const other=await login('doctor.b@staging.test',pw.TEST_DOCTOR_B_PASSWORD),admin=await login('admin.only@staging.test',pw.TEST_ADMIN_ONLY_PASSWORD)
 for(const c of[other,admin])assert.equal(checked(await c.from('document_archives').select('id').eq('clinic_id',clinic)).length,0)
 const anonymous=createClient(app.VITE_SUPABASE_URL,app.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false},realtime:{transport:ws}})
 const publicRead=await anonymous.from('document_archives').select('id');assert.ok(publicRead.error || publicRead.data.length===0,'anonymous cannot read archives')
 assert.ok((await doctor.from('document_archives').update({snapshot:{forged:true}}).eq('id',rx.id)).error,'doctor cannot rewrite an issued snapshot')
 assert.ok((await reception.rpc('claim_document_archive',{p_id:receipt.id,p_lease_id:crypto.randomUUID()})).error,'upload claim is server-only')
 console.log('PASS: atomic archive jobs, frozen snapshots, prescription privacy, idempotent cash receipts, separate corrections, settlement timing and clinic/role boundaries')
}finally{await Promise.all(clients.map(c=>c.auth.signOut({scope:'local'})))}
