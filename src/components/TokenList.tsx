import { LoadingRows, QueryError } from './QueryState'
import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { startOfToday, elapsedMinutes, formatElapsed } from '../lib/date'
import { nextSortState, sortRows, type SortState } from '../lib/sort'
import { Button } from './ui/button'
import './Worklist.css'
import { useQueueAction, type QueueAction } from '../lib/queueActions'
import { Input } from './ui/input'
import { restorePagedCache } from '../lib/pagedCache'
import { useQueuePollInterval } from '../lib/realtimeStatus'
import { STAGES, stageLabel } from '../lib/stageLabels'

type Visit = {
  id: string
  token_number: number
  stage: string
  queue_position: number
  not_here_at: string | null
  queue_note: string | null
  complaint: string
  arrived_at: string
  patients: { name: string; age: number | null; gender: string | null } | null
}

function StageGlyph({ stage }: { stage: string }) {
  const meta = STAGES[stage] ?? { label: stage, color: 'var(--text-tertiary)' }
  return (
    <span className="stage-pill" style={{ color: meta.color }}>
      {meta.label}
    </span>
  )
}

// Stages the receptionist can click into to open (or reopen) a bill --
// "with_doctor"/"waiting" have nothing for her to do yet.
const BILLABLE_STAGES = new Set(['ready_to_bill', 'paid'])

type SortKey = 'token' | 'name' | 'stage' | 'wait'

function sortValue(v: Visit, key: SortKey): string | number {
  switch (key) {
    case 'token':
      return v.token_number
    case 'name':
      return v.patients?.name ?? ''
    case 'stage':
      return stageLabel(v.stage)
    case 'wait':
      return elapsedMinutes(v.arrived_at)
  }
}

export function TokenList({ clinicId, onSelectVisit, highlightVisitId }: { clinicId: string; onSelectVisit?: (visitId: string) => void; highlightVisitId?: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['visits-today', clinicId]
  const interval = useQueuePollInterval()
  const today = startOfToday()
  const [visibleCount, setVisibleCount] = useState(50)
  const [filter, setFilter] = useState<'active' | 'done' | 'all' | 'earlier'>('active')
  const [reason, setReason] = useState('')
  const [confirmNoShow, setConfirmNoShow] = useState<string | null>(null)
  const action = useQueueAction(clinicId)
  const { data: settings } = useQuery({ queryKey: ['queue-settings',clinicId], queryFn: async () => { const {data,error}=await supabase.from('clinics').select('no_show_minutes').eq('id',clinicId).single(); if(error) throw error; return data } })
  const [sort, setSort] = useState<SortState<SortKey>>(null)

  const { data, isLoading, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey, refetchInterval: interval,
    enabled: filter !== 'earlier',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('id, token_number, stage, arrived_at, complaint, queue_position, not_here_at, queue_note, patients(name, age, gender)')
        .eq('clinic_id', clinicId)
        .gte('arrived_at', today)
        .order('queue_position', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return data as unknown as Visit[]
    },
  })

  const earlier = useInfiniteQuery({
    queryKey: ['visits-earlier', clinicId, today, 'pages'],
    enabled: filter === 'earlier', refetchInterval: interval,
    initialData: () => {
      const legacy = queryClient.getQueryData<Visit[]>(queryKey)
      const saved = queryClient.getQueryCache().findAll({ queryKey: ['visits-earlier', clinicId] })
        .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt).find(query => query.state.data)
      return restorePagedCache<Visit>(saved?.state.data as { pages: Visit[][] } | undefined, legacy?.filter(v => v.arrived_at < today && !['paid', 'no_show'].includes(v.stage)))
    },
    initialPageParam: 0,
    getNextPageParam: (last: Visit[], pages: Visit[][]) => last.length === 50 ? pages.length * 50 : undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.from('visits')
        .select('id, token_number, stage, arrived_at, complaint, queue_position, not_here_at, queue_note, patients(name, age, gender)')
        .eq('clinic_id', clinicId).lt('arrived_at', today)
        .in('stage', ['waiting', 'called', 'with_doctor', 'not_here', 'ready_to_bill'])
        .order('arrived_at', { ascending: false }).order('id').range(pageParam, pageParam + 49)
      if (error) throw error
      return data as unknown as Visit[]
    },
  })

  const focused = useQuery({queryKey:['queue-alert-visit',clinicId,highlightVisitId],enabled:!!highlightVisitId,queryFn:async()=>{const {data,error}=await supabase.from('visits').select('id, token_number, stage, arrived_at, complaint, queue_position, not_here_at, queue_note, patients(name, age, gender)').eq('clinic_id',clinicId).eq('id',highlightVisitId!).maybeSingle();if(error)throw error;return data as unknown as Visit|null}})
  useEffect(() => { if (focused.data) { setFilter(focused.data.arrived_at < today ? 'earlier' : 'all'); setVisibleCount(50) } }, [highlightVisitId,focused.data,today])
  const showingEarlier = filter === 'earlier'
  const viewData = showingEarlier ? earlier.data?.pages.flat() : data
  const viewError = showingEarlier ? earlier.isError : isError
  const reload = showingEarlier ? earlier.refetch : refetch
  const savedAt = showingEarlier ? earlier.dataUpdatedAt : dataUpdatedAt
  if (showingEarlier ? earlier.isLoading : isLoading) return <LoadingRows label="Loading queue…" />
  if (viewError && !viewData) return <QueryError retry={() => void reload()} />
  const viewWithFocus = focused.data && !(viewData ?? []).some(v=>v.id===focused.data!.id) ? [focused.data,...(viewData ?? [])] : viewData ?? []
  const rows = sortRows(viewWithFocus.filter(v => showingEarlier ? v.arrived_at < today && !['paid','no_show'].includes(v.stage) : v.arrived_at >= today && (filter === 'all' || (filter === 'done' ? ['paid','no_show'].includes(v.stage) : !['paid','no_show'].includes(v.stage)))), sort, sortValue)
  // The typed reason belongs to this one action; leaving it in the box tagged the next, unrelated move with it.
  const act = (v: Visit, value: QueueAction) => { action.mutate({ visitId:v.id, action:value, reason }); setReason(''); setConfirmNoShow(null) }
  return <div className="queue-worklist">
    {viewError && <QueryError retry={() => void reload()} savedAt={savedAt} />}
    <div className="queue-tools">
      <div className="queue-filters" role="group" aria-label="Queue filter">{(['active', 'done', 'all', 'earlier'] as const).map(value => <button key={value} className="shell-nav-item" aria-pressed={filter === value} onClick={() => { setFilter(value); setVisibleCount(50) }}>{value === 'done' ? 'Finished' : value === 'active' ? 'Now' : value === 'earlier' ? 'Earlier days' : 'Everyone today'}</button>)}</div>
      <details className="queue-sort"><summary>Sort</summary>{(['token', 'name', 'stage', 'wait'] as const).map(key => <button key={key} className="shell-nav-item" onClick={() => setSort(nextSortState(sort, key))}>{key}{sort?.key === key ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}</button>)}</details>
    </div>
    {onSelectVisit && <Input aria-label="Optional queue move reason" placeholder="Move reason (optional)" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} />}
    {action.isError && <p className="form-error" role="alert">{action.error.message}</p>}
    {!rows.length && <p className="readout-empty">No patients in this view.</p>}
    <ul className={viewError ? "queue-patients stale-copy" : "queue-patients"}>{[...rows].sort((a,b) => Number(b.id === highlightVisitId) - Number(a.id === highlightVisitId)).slice(0, visibleCount).map(v => <li className={`queue-patient${v.id === highlightVisitId ? ' alert-highlight' : ''}`} key={v.id}>
      <strong className="queue-token">#{v.token_number}</strong>
      <div className="queue-patient-name"><strong>{v.patients?.name}</strong> <span>{[v.patients?.age, v.patients?.gender].filter(Boolean).join(' ')}</span><p>{v.complaint}</p>{v.queue_note && <p className="status-blue">{v.queue_note}</p>}{v.not_here_at && <p>Not here since {new Date(v.not_here_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</p>}</div>
      <time className="queue-time" dateTime={v.arrived_at} title={new Date(v.arrived_at).toLocaleString()}>{formatElapsed(v.arrived_at)}</time>
      <StageGlyph stage={v.stage} />
      <div className="queue-action">{onSelectVisit && <>
        {v.stage==='waiting' && v.arrived_at>=today && <><Button variant="ghost" disabled={action.isPending} onClick={()=>act(v,'move_up')}>Move up</Button><Button variant="ghost" disabled={action.isPending} onClick={()=>act(v,'move_down')}>Move down</Button></>}
        {v.stage==='called' && <Button variant="dark" disabled={action.isPending} onClick={()=>act(v,'sent_in')}>Sent in</Button>}
        {['waiting','called'].includes(v.stage) && <Button variant="ghost" disabled={action.isPending} onClick={()=>act(v,'not_here')}>Not here</Button>}
        {v.stage==='not_here' && v.arrived_at>=today && <><Button variant="ghost" disabled={action.isPending} onClick={()=>act(v,'return_original')}>Return to position</Button><Button variant="ghost" disabled={action.isPending} onClick={()=>act(v,'return_end')}>Return at end</Button></>}
        {(v.stage==='not_here' && v.not_here_at && elapsedMinutes(v.not_here_at)>=(settings?.no_show_minutes??30) || v.arrived_at<today && ['waiting','called','with_doctor'].includes(v.stage)) && <><span className="status-amber">Please review: has this patient returned?</span>{confirmNoShow !== v.id && <Button variant="ghost" disabled={action.isPending} onClick={()=>setConfirmNoShow(v.id)}>Mark no-show</Button>}</>}
      </>}{onSelectVisit && BILLABLE_STAGES.has(v.stage) && <Button variant="secondary" size="sm" onClick={() => onSelectVisit(v.id)}>{v.stage === 'paid' ? 'Receipt' : 'Bill'}</Button>}</div>
      {confirmNoShow === v.id && <div className="queue-confirm" role="alert"><span className="status-amber">Close this visit? It cannot be reopened; the patient would need a new token.</span><Button variant="dark" disabled={action.isPending} onClick={()=>act(v,'no_show')}>Confirm no-show</Button><Button variant="ghost" onClick={()=>setConfirmNoShow(null)}>Cancel</Button></div>}
    </li>)}</ul>
    {(rows.length > visibleCount || showingEarlier && earlier.hasNextPage) && <Button variant="secondary" disabled={earlier.isFetchingNextPage} onClick={() => { if (showingEarlier && rows.length <= visibleCount && earlier.hasNextPage) void earlier.fetchNextPage(); setVisibleCount(count => count + 50) }}>{earlier.isFetchingNextPage ? 'Loading…' : 'Show more'}</Button>}
  </div>
}
