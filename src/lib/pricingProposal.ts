export type PricingLine = {kind:string;quantity:number;unit_price_paise:number;procedure_id?:string;visit_procedure_id?:string;prescription_item_id?:string;medicine_id?:string;stock_unit?:string|null;description?:string;line_total_paise?:number}
export type PricingProposal = {lines:PricingLine[];total_paise:number;revision_number:number}
// Keep the exact reviewed quantities/prices while their preceding writes wait to sync.
export function changeProposal(proposal:PricingProposal|null|undefined,change:(lines:PricingLine[])=>PricingLine[]):PricingProposal|null {
 if(!proposal)return null
 const changed=change(proposal.lines)
 // A committed write can refetch before its lost response queues a retry.
 const lines=changed.filter((line,index)=>{
  const id=line.prescription_item_id??line.visit_procedure_id
  return !id||!changed.slice(index+1).some(l=>(l.prescription_item_id??l.visit_procedure_id)===id)
 })
 if(lines.some(l=>!Number.isSafeInteger(l.quantity)||l.quantity<0||!Number.isSafeInteger(l.unit_price_paise)||l.unit_price_paise<0))return null
 const total=lines.reduce((sum,l)=>sum+l.quantity*l.unit_price_paise,0)
 if(!Number.isSafeInteger(total)||total<0)return null
 return {...proposal,lines,total_paise:total}
}
