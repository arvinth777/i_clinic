import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { startOfToday } from '../lib/date'
import { restorePagedCache } from '../lib/pagedCache'
import { Billing } from '../components/Billing'
import { LoadingRows, QueryError } from '../components/QueryState'

type Visit = { id: string; token_number: number; stage: string; patients: { name: string } | null }
export function BillingDesk({ clinicId, readOnly = false, initialVisitId }: { clinicId: string; readOnly?: boolean; initialVisitId?: string }) {
  const client = useQueryClient()
  const [visibleCount, setVisibleCount] = useState(50)
  useEffect(() => {
    const channel = supabase.channel(`billing-desk-${clinicId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `clinic_id=eq.${clinicId}` }, () => client.invalidateQueries({ queryKey: ['billing-desk', clinicId] })).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [clinicId, client])
  const [selected, setSelected] = useState<string | null>(initialVisitId ?? null)
  useEffect(() => { if (initialVisitId) setSelected(initialVisitId) }, [initialVisitId])
  const { data: pages, isError, dataUpdatedAt, isPending, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({ queryKey: ['billing-desk', clinicId, 'pages-v2'], initialData: () => restorePagedCache(client.getQueryData<{ pages: Visit[][] }>(['billing-desk', clinicId, 'pages']), client.getQueryData<Visit[]>(['billing-desk', clinicId])), initialPageParam: 0, getNextPageParam: (last: Visit[], pages: Visit[][]) => last.length === 50 ? pages.length * 50 : undefined, queryFn: async ({ pageParam }) => {
    const { data, error } = await supabase.from('visits').select('id, token_number, stage, patients(name)').eq('clinic_id', clinicId)
      .in('stage', ['ready_to_bill', 'paid']).or(`stage.neq.paid,arrived_at.gte.${startOfToday()}`).order('arrived_at', { ascending: false }).order('id').range(pageParam, pageParam + 49)
    if (error) throw error
    return data as unknown as Visit[]
  } })
  const visits = pages?.pages.flat()
  return <div className={`billing-desk${selected ? " has-selection" : ""}`}><aside className="record-sidebar"><p className="field-hint">To collect / recent receipts</p>
    {isError && <QueryError retry={() => void refetch()} savedAt={dataUpdatedAt} />}
    {isPending && <LoadingRows label="Loading bills…" />}
    <div className={isError ? "stale-copy" : undefined}>
    {visits?.slice(0, visibleCount).map(v => <button key={v.id} className="record-selector" aria-pressed={selected === v.id} onClick={() => { setSelected(v.id); window.scrollTo({ top: 0, behavior: 'instant' }) }}><strong>#{v.token_number} {v.patients?.name}</strong><small>{v.stage === 'paid' ? 'Paid' : 'Ready to bill'}</small></button>)}
    </div>
    {(visibleCount < (visits?.length ?? 0) || hasNextPage) && <button className="ui-button ui-button-neutral" disabled={isFetchingNextPage} onClick={async () => { if (visibleCount >= (visits?.length ?? 0) && (await fetchNextPage()).isError) return; setVisibleCount(count => count + 50) }}>{isFetchingNextPage ? 'Loading…' : 'Show more'}</button>}
    {visits?.length === 0 && <p className="field-hint">No bills to collect.</p>}
  </aside>{selected ? <Billing readOnly={readOnly} key={selected} clinicId={clinicId} visitId={selected} onClose={() => setSelected(null)} /> : <div className="bill-editor"><h2 className="readout-heading">Billing</h2><p className="readout-empty">Choose a visit to collect payment or reprint a receipt.</p></div>}</div>
}
