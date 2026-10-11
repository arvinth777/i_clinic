import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { startOfToday, formatDate, formatDateOnly } from '../lib/date'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'

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
        <h2 className="readout-heading">Long-term care</h2>
      </div>
      {!rows || rows.length === 0 ? (
        <p className="readout-empty">No long-term patients flagged yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Last visit</TableHead>
              <TableHead>Next review due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const overdue = r.next_review_due < today
              return (
                <TableRow key={r.patient_id}>
                  <TableCell className="worklist-name-cell">{r.name}</TableCell>
                  <TableCell className="worklist-wait-cell">{r.last_visit_at ? formatDate(r.last_visit_at) : 'No visits yet'}</TableCell>
                  <TableCell className={overdue ? 'worklist-wait-cell doctor-queue-overdue' : 'worklist-wait-cell'}>{formatDateOnly(r.next_review_due)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
