import assert from 'node:assert/strict'
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
