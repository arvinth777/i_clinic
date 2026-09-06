import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { startOfToday, formatDateOnly } from '../lib/date'

type Todo = { id: string; follow_up_date: string; patients: { name: string } | null }

// No WhatsApp yet (out of scope for the whole build) -- this is the
// PRD's stated fallback: the follow-up "surfaces to reception as a
// to-do on the due date" instead of a message. Due today or overdue,
// not yet marked done.
export function FollowUpTodos({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['follow-up-todos', clinicId]
  const today = startOfToday().slice(0, 10)

  const { data: todos } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('id, follow_up_date, patients(name)')
        .eq('clinic_id', clinicId)
        .lte('follow_up_date', today)
        .is('follow_up_done_at', null)
        .order('follow_up_date', { ascending: true })
      if (error) throw error
      return data as unknown as Todo[]
    },
  })

  const markDone = useMutation({
    mutationFn: async (visitId: string) => {
      const { error } = await supabase.rpc('mark_follow_up_done', { p_visit_id: visitId })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  if (!todos || todos.length === 0) return null

  return (
    <section className="record-section">
      <h3 className="readout-heading">Follow-ups due</h3>
      <ul className="past-visit-list">
        {todos.map((t) => (
          <li key={t.id} className="past-visit-item bill-item-row">
            <span>
              {t.patients?.name} — due {formatDateOnly(t.follow_up_date)}
            </span>
            <button type="button" className="secondary-button" disabled={markDone.isPending} onClick={() => markDone.mutate(t.id)}>
              Done
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
