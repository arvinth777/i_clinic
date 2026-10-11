import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { startOfToday, formatElapsed } from '../lib/date'
import { Button } from './ui/button'

type Rep = { id: string; rep_name: string; company: string; arrived_at: string }

// Reps always render below every patient row in Consultation.tsx's queue
// rail -- this component owns only that appended block, never interleaved
// with the patient rows above it, so "always after every waiting
// patient, including later arrivals" (PRD) holds regardless of arrival
// order.
export function RepQueueRows({ clinicId, onCountChange }: { clinicId: string; onCountChange?: (count: number) => void }) {
  const queryClient = useQueryClient()
  const queryKey = ['doctor-reps', clinicId]

  const { data: reps } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pharma_rep_checkins')
        .select('id, rep_name, company, arrived_at')
        .eq('clinic_id', clinicId)
        .is('done_at', null)
        .gte('arrived_at', startOfToday())
        .order('arrived_at', { ascending: true })
      if (error) throw error
      return data as Rep[]
    },
  })

  useEffect(() => {
    const channel = supabase
      .channel(`doctor-reps-${clinicId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pharma_rep_checkins', filter: `clinic_id=eq.${clinicId}` },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId])

  const markDone = useMutation({
    mutationFn: async (repId: string) => {
      const { error } = await supabase.from('pharma_rep_checkins').update({ done_at: new Date().toISOString() }).eq('id', repId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  useEffect(() => {
    onCountChange?.(reps?.length ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reps])

  if (!reps || reps.length === 0) return null

  return (
    <>
      {reps.map((rep) => (
        <li key={rep.id} className="rail-row rail-row-rep">
          <span className="rail-row-name">
            {rep.rep_name} · {rep.company}
          </span>
          <span className="rail-row-wait">{formatElapsed(rep.arrived_at)}</span>
          <Button type="button" size="sm" variant="secondary" disabled={markDone.isPending} onClick={() => markDone.mutate(rep.id)}>
            Done
          </Button>
        </li>
      ))}
    </>
  )
}
