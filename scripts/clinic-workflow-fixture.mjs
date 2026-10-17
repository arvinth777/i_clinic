import assert from 'node:assert/strict'
export function assertStaging(url) { assert.equal(new URL(url).hostname, 'cofnrcgsolluyhghutah.supabase.co', 'Live tests must target staging') }
export function checked(result){assert.ifError(result.error);return result.data}
// Drive synthetic fixtures through the same queue/approval boundary as both screens.
export async function sendToBilling(doctor,reception,clinicId,visitId,amount){
 const proposal=checked(await doctor.rpc('get_pricing_proposal',{p_visit_id:visitId}))
 const final=amount??proposal.total_paise
 const revision=checked(await doctor.rpc('approve_visit_pricing',{p_visit_id:visitId,p_final_amount_paise:final,p_expected_total_paise:proposal.total_paise,p_expected_revision_number:proposal.revision_number,p_request_id:crypto.randomUUID()}))
 const midnight=new Date();midnight.setHours(0,0,0,0)
 const waiting=checked(await reception.from('visits').select('id').eq('clinic_id',clinicId).eq('stage','waiting').gte('arrived_at',midnight.toISOString()).order('queue_position'))
 const command=(client,action)=>client.rpc('queue_visit_action',{p_visit_id:visitId,p_action:action,p_request_id:crypto.randomUUID()})
 for(let i=0;i<waiting.findIndex(v=>v.id===visitId);i++)checked(await command(reception,'move_up'))
 checked(await command(doctor,'call'));checked(await command(reception,'sent_in'));checked(await command(doctor,'finish'))
 return {final_amount_paise:final,revision_number:revision}
}

// Legacy report/credit checks still need a valid prescription under the new Finish rule.
export async function consultationOnlyFixture(doctor,reception,clinicId,visitId,amount){
 const medicine=checked(await doctor.from('medicines').insert({clinic_id:clinicId,name:`TEST ONLY consultation fixture ${crypto.randomUUID()}`,price_paise:0}).select('id').single())
 checked(await doctor.rpc('set_medicine_unit_price',{p_medicine_id:medicine.id,p_stock_unit:'tablet',p_price_paise:0}))
 const counter=checked(await reception.from('stock_points').select('id').eq('clinic_id',clinicId).eq('name','Counter').single()).id
 checked(await reception.rpc('adjust_stock',{p_clinic_id:clinicId,p_medicine_id:medicine.id,p_stock_point_id:counter,p_quantity_delta:1,p_reason:'Synthetic regression fixture stock'}))
 checked(await doctor.rpc('save_prescription',{p_prescription_id:crypto.randomUUID(),p_visit_id:visitId,p_items:[{id:crypto.randomUUID(),medicine_id:medicine.id,quantity_dispensed:1,dosage_frequency:'SOS',duration_days:1}]}))
 return sendToBilling(doctor,reception,clinicId,visitId,amount)
}
