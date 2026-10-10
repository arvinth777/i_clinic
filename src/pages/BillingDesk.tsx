import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { startOfToday } from '../lib/date'
import { Billing } from '../components/Billing'

type Visit = { id: string; token_number: number; stage: string; patients: { name: string } | null }
export function BillingDesk({ clinicId }: { clinicId: string }) {
  const client = useQueryClient()
  useEffect(() => {
    const channel = supabase.channel(`billing-desk-${clinicId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `clinic_id=eq.${clinicId}` }, () => client.invalidateQueries({ queryKey: ['billing-desk', clinicId] })).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [clinicId, client])
  const [selected, setSelected] = useState<string | null>(null)
  const { data: visits, isError } = useQuery({ queryKey: ['billing-desk', clinicId], queryFn: async () => {
    const { data, error } = await supabase.from('visits').select('id, token_number, stage, patients(name)').eq('clinic_id', clinicId)
      .in('stage', ['packing', 'ready_at_reception', 'paid']).or(`stage.neq.paid,arrived_at.gte.${startOfToday()}`).order('arrived_at', { ascending: false })
    if (error) throw error
    return data as unknown as Visit[]
  } })
  return <div className="billing-desk"><aside className="record-sidebar"><p className="field-hint">To collect / recent receipts</p>
    {isError && <p className="form-error">Couldn't load bills.</p>}
    {visits?.map(v => <button key={v.id} className="record-selector" aria-pressed={selected === v.id} onClick={() => setSelected(v.id)}><strong>#{v.token_number} {v.patients?.name}</strong><small>{v.stage === 'paid' ? 'Paid' : 'Ready to bill'}</small></button>)}
    {visits?.length === 0 && <p className="field-hint">No bills to collect.</p>}
  </aside>{selected ? <Billing key={selected} clinicId={clinicId} visitId={selected} onClose={() => setSelected(null)} /> : <div className="bill-editor"><h2 className="readout-heading">Billing</h2><p className="readout-empty">Choose a visit to collect payment or reprint a receipt.</p></div>}</div>
}
