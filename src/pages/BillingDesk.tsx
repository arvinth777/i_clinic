import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { startOfToday } from '../lib/date'
import { Billing } from '../components/Billing'

type Visit = { id: string; token_number: number; stage: string; patients: { name: string } | null }
export function BillingDesk({ clinicId, readOnly = false }: { clinicId: string; readOnly?: boolean }) {
  const client = useQueryClient()
  useEffect(() => {
    const channel = supabase.channel(`billing-desk-${clinicId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `clinic_id=eq.${clinicId}` }, () => client.invalidateQueries({ queryKey: ['billing-desk', clinicId] })).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [clinicId, client])
  const [selected, setSelected] = useState<string | null>(null)
  const { data: pages, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({ queryKey: ['billing-desk', clinicId, 'pages'], initialData: () => { const saved = client.getQueryData<Visit[]>(['billing-desk', clinicId]); return Array.isArray(saved) ? { pages: [saved.slice(0, 50)], pageParams: [0] } : undefined }, initialPageParam: 0, getNextPageParam: (last: Visit[], pages: Visit[][]) => last.length === 50 ? pages.length * 50 : undefined, queryFn: async ({ pageParam }) => {
    const { data, error } = await supabase.from('visits').select('id, token_number, stage, patients(name)').eq('clinic_id', clinicId)
      .in('stage', ['packing', 'ready_at_reception', 'paid']).or(`stage.neq.paid,arrived_at.gte.${startOfToday()}`).order('arrived_at', { ascending: false }).order('id').range(pageParam, pageParam + 49)
    if (error) throw error
    return data as unknown as Visit[]
  } })
  const visits = pages?.pages.flat()
  return <div className="billing-desk"><aside className="record-sidebar"><p className="field-hint">To collect / recent receipts</p>
    {isError && <p className="form-error">Couldn't load bills.</p>}
    {visits?.map(v => <button key={v.id} className="record-selector" aria-pressed={selected === v.id} onClick={() => setSelected(v.id)}><strong>#{v.token_number} {v.patients?.name}</strong><small>{v.stage === 'paid' ? 'Paid' : 'Ready to bill'}</small></button>)}
    {hasNextPage && <button className="ui-button" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? 'Loading…' : 'Show more'}</button>}
    {visits?.length === 0 && <p className="field-hint">No bills to collect.</p>}
  </aside>{selected ? <Billing readOnly={readOnly} key={selected} clinicId={clinicId} visitId={selected} onClose={() => setSelected(null)} /> : <div className="bill-editor"><h2 className="readout-heading">Billing</h2><p className="readout-empty">Choose a visit to collect payment or reprint a receipt.</p></div>}</div>
}
