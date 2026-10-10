export type PricingLine = {kind:string;quantity:number;unit_price_paise:number;procedure_id?:string;prescription_item_id?:string;medicine_id?:string;stock_unit?:string|null;description?:string;line_total_paise?:number}
export type PricingProposal = {lines:PricingLine[];total_paise:number;revision_number:number}
// Keep the exact reviewed quantities/prices while their preceding writes wait to sync.
export function changeProposal(proposal:PricingProposal|undefined,change:(lines:PricingLine[])=>PricingLine[]):PricingProposal|undefined {
 if(!proposal)return undefined
 const lines=change(proposal.lines)
 const total=lines.reduce((sum,l)=>sum+l.quantity*l.unit_price_paise,0)
 if(!Number.isSafeInteger(total)||total<0)return undefined
 return {...proposal,lines,total_paise:total}
}
