import { LoadingRows, QueryError } from './QueryState'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { startOfToday, elapsedMinutes, formatElapsed } from '../lib/date'
import { nextSortState, sortRows, type SortState } from '../lib/sort'
import { Button } from './ui/button'
import './Worklist.css'
import { useQueueAction, type QueueAction } from '../lib/queueActions'
import { Input } from './ui/input'

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

const STAGES: Record<string, { label: string; color: string }> = {
  waiting: { label: 'Waiting', color: 'var(--stage-waiting)' },
  with_doctor: { label: 'With doctor', color: 'var(--stage-with-doctor)' },
  called: { label: 'Called · waiting for reception', color: 'var(--blue)' },
  ready_to_bill: { label: 'Ready to bill', color: 'var(--amber)' },
  not_here: { label: 'Not here', color: 'var(--muted)' },
  no_show: { label: 'No-show', color: 'var(--muted)' },
  paid: { label: 'Paid', color: 'var(--stage-paid)' },
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
      return STAGES[v.stage]?.label ?? v.stage
    case 'wait':
      return elapsedMinutes(v.arrived_at)
  }
}

export function TokenList({ clinicId, onSelectVisit }: { clinicId: string; onSelectVisit?: (visitId: string) => void }) {
  const queryClient = useQueryClient()
  const queryKey = ['visits-today', clinicId]
  const [visibleCount, setVisibleCount] = useState(50)
  const [filter, setFilter] = useState<'active' | 'done' | 'all' | 'earlier'>('active')
  const [reason, setReason] = useState('')
  const action = useQueueAction(clinicId)
  const { data: settings } = useQuery({ queryKey: ['queue-settings',clinicId], queryFn: async () => { const {data,error}=await supabase.from('clinics').select('no_show_minutes').eq('id',clinicId).single(); if(error) throw error; return data } })
  const [sort, setSort] = useState<SortState<SortKey>>(null)

  const { data, isLoading, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      // "Today" alone used to be the whole filter -- but a visit that's
      // still unpaid when it crosses midnight would silently drop off
      // this list forever, with real money owed and no UI path left to
      // collect it (docs/STATUS.md's Phase G audit). Anything not yet
      // paid stays visible regardless of arrival date, same as the
      // doctor's own queue never date-scopes at all; a visit that's
      // already paid keeps the "today" scope, so settled history doesn't
      // pile up here indefinitely.
      const { data, error } = await supabase
        .from('visits')
        .select('id, token_number, stage, arrived_at, complaint, queue_position, not_here_at, queue_note, patients(name, age, gender)')
        .eq('clinic_id', clinicId)
        .or(`arrived_at.gte.${startOfToday()},stage.neq.paid`)
        .order('queue_position', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return data as unknown as Visit[]
    },
  })

  // An event invalidates the query and triggers a refetch -- it never
  // patches state from the payload (AGENTS.md non-negotiable #6 / Technical
  // Decision #3). Sockets drop on sleep/wifi flap; refetchInterval on the
  // query client is what self-heals a missed event.
  useEffect(() => {
    const channel = supabase
      .channel(`visits-today-${clinicId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visits', filter: `clinic_id=eq.${clinicId}` },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId])

  if (isLoading) return <LoadingRows label="Loading queue…" />
  if (isError && !data) return <QueryError retry={() => void refetch()} />
  const today = startOfToday()
  const rows = sortRows((data ?? []).filter(v => filter === 'earlier' ? v.arrived_at < today && !['paid','no_show'].includes(v.stage) : v.arrived_at >= today && (filter === 'all' || (filter === 'done' ? ['paid','no_show'].includes(v.stage) : !['paid','no_show'].includes(v.stage)))), sort, sortValue)
  const act = (v: Visit, value: QueueAction) => action.mutate({ visitId:v.id, action:value, reason })
  return <div className="queue-worklist">
    {isError && <QueryError retry={() => void refetch()} savedAt={dataUpdatedAt} />}
    <div className="queue-tools">
      <div className="queue-filters" aria-label="Queue filter">{(['active', 'done', 'all', 'earlier'] as const).map(value => <button key={value} className="shell-nav-item" aria-pressed={filter === value} onClick={() => { setFilter(value); setVisibleCount(50) }}>{value === 'done' ? 'Done today' : value === 'active' ? 'Active' : value === 'earlier' ? 'Earlier open visits' : 'All today'}</button>)}</div>
      <details className="queue-sort"><summary>Sort</summary>{(['token', 'name', 'stage', 'wait'] as const).map(key => <button key={key} className="shell-nav-item" onClick={() => setSort(nextSortState(sort, key))}>{key}{sort?.key === key ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}</button>)}</details>
    </div>
    {onSelectVisit && <Input aria-label="Optional queue move reason" placeholder="Move reason (optional)" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} />}
    {action.isError && <p className="form-error" role="alert">{action.error.message}</p>}
    {!rows.length && <p className="readout-empty">No patients in this view.</p>}
    <ul className={isError ? "queue-patients stale-copy" : "queue-patients"}>{rows.slice(0, visibleCount).map(v => <li className="queue-patient" key={v.id}>
      <strong className="queue-token">#{v.token_number}</strong>
      <div className="queue-patient-name"><strong>{v.patients?.name}</strong> <span>{[v.patients?.age, v.patients?.gender].filter(Boolean).join(' ')}</span><p>{v.complaint}</p>{v.queue_note && <p className="status-blue">{v.queue_note}</p>}{v.not_here_at && <p>Not here since {new Date(v.not_here_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</p>}</div>
      <time className="queue-time" dateTime={v.arrived_at} title={new Date(v.arrived_at).toLocaleString()}>{formatElapsed(v.arrived_at)}</time>
      <StageGlyph stage={v.stage} />
      <div className="queue-action">{onSelectVisit && <>
        {v.stage==='waiting' && v.arrived_at>=today && <><Button variant="ghost" disabled={action.isPending} onClick={()=>act(v,'move_up')}>Move up</Button><Button variant="ghost" disabled={action.isPending} onClick={()=>act(v,'move_down')}>Move down</Button></>}
        {v.stage==='called' && <Button variant="dark" disabled={action.isPending} onClick={()=>act(v,'sent_in')}>Sent in</Button>}
        {['waiting','called'].includes(v.stage) && <Button variant="ghost" disabled={action.isPending} onClick={()=>act(v,'not_here')}>Not here</Button>}
        {v.stage==='not_here' && v.arrived_at>=today && <><Button variant="ghost" disabled={action.isPending} onClick={()=>act(v,'return_original')}>Return to position</Button><Button variant="ghost" disabled={action.isPending} onClick={()=>act(v,'return_end')}>Return at end</Button></>}
        {(v.stage==='not_here' && v.not_here_at && elapsedMinutes(v.not_here_at)>=(settings?.no_show_minutes??30) || v.arrived_at<today && ['waiting','called','with_doctor'].includes(v.stage)) && <><span className="status-amber">Please review: has this patient returned?</span><Button variant="ghost" disabled={action.isPending} onClick={()=>act(v,'no_show')}>Mark no-show</Button></>}
      </>}{onSelectVisit && BILLABLE_STAGES.has(v.stage) && <Button variant="secondary" size="sm" onClick={() => onSelectVisit(v.id)}>{v.stage === 'paid' ? 'Receipt' : 'Bill'}</Button>}</div>
    </li>)}</ul>
    {rows.length > visibleCount && <Button variant="secondary" onClick={() => setVisibleCount(count => count + 50)}>Show more</Button>}
  </div>
}
