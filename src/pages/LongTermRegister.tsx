import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { startOfToday, formatDate, formatDateOnly } from '../lib/date'

type RegisterRow = { patient_id: string; name: string; last_visit_at: string | null; next_review_due: string }

export function LongTermRegister({ clinicId }: { clinicId: string }) {
  const { data: rows } = useQuery({
    queryKey: ['long-term-register', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('long_term_register')
        .select('patient_id, name, last_visit_at, next_review_due')
        .eq('clinic_id', clinicId)
        .order('next_review_due', { ascending: true })
      if (error) throw error
      return data as RegisterRow[]
    },
  })

  const today = startOfToday().slice(0, 10)

  return (
    <div className="admin-page">
      <div className="admin-toolbar">
        <h2 className="readout-heading">Long-term register</h2>
      </div>
      {!rows || rows.length === 0 ? (
        <p className="readout-empty">No long-term patients flagged yet.</p>
      ) : (
        <div className="worklist-scroll">
          <table className="worklist">
            <thead>
              <tr>
                <th>Name</th>
                <th>Last visit</th>
                <th>Next review due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const overdue = r.next_review_due < today
                return (
                  <tr key={r.patient_id} className="worklist-row">
                    <td className="worklist-name-cell">{r.name}</td>
                    <td className="worklist-wait-cell">{r.last_visit_at ? formatDate(r.last_visit_at) : 'No visits yet'}</td>
                    <td className={overdue ? 'worklist-wait-cell doctor-queue-overdue' : 'worklist-wait-cell'}>{formatDateOnly(r.next_review_due)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
