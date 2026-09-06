import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatPaise } from '../lib/money'
import { formatDate } from '../lib/date'

// The resolution half of docs/architecture-spec.md's offline money-
// conflict design (detection -- bills_needing_reconciliation, surfaced as
// a count on the Daily Report -- already existed). Doctor-only, same
// reasoning as merge_patients: deciding what the correct amount actually
// was is a clinical/billing judgment tied to the doctor's own pricing
// decision, not admin configuration, and non-negotiable #2 keeps final
// pricing doctor-only regardless.
type Flagged = {
  id: string
  visit_id: string
  patient_name: string
  token_number: number
  arrived_at: string
  final_amount_paise: number
  live_final_amount_paise: number
  confirmed_at: string
}

export function Reconciliation({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['bills-needing-reconciliation', clinicId]
  const { data: flagged } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bills_needing_reconciliation')
        .select('id, visit_id, patient_name, token_number, arrived_at, final_amount_paise, live_final_amount_paise, confirmed_at')
        .eq('clinic_id', clinicId)
        .order('confirmed_at', { ascending: true })
      if (error) throw error
      return data as Flagged[]
    },
  })

  const correct = useMutation({
    mutationFn: async (billId: string) => {
      const { error } = await supabase.rpc('correct_bill', { p_bill_id: billId })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  return (
    <div className="admin-page">
      <div className="admin-toolbar">
        <h2 className="readout-heading">Needs reconciliation</h2>
      </div>
      <p className="readout-empty">
        A bill confirmed while offline, against a price that changed before it synced. Correcting writes a new bill
        referencing the original at today's actual price — the original is never edited (non-negotiable #3).
      </p>
      {(flagged ?? []).length === 0 ? (
        <p className="readout-empty">Nothing flagged right now.</p>
      ) : (
        <div className="worklist-scroll">
          <table className="worklist">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Token</th>
                <th>Billed on</th>
                <th>Billed as</th>
                <th>Actual amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(flagged ?? []).map((b) => (
                <tr key={b.id} className="worklist-row">
                  <td className="worklist-name-cell">{b.patient_name}</td>
                  <td className="worklist-wait-cell">{b.token_number}</td>
                  <td className="worklist-wait-cell">{formatDate(b.confirmed_at)}</td>
                  <td className="worklist-wait-cell">{formatPaise(b.final_amount_paise)}</td>
                  <td className="worklist-wait-cell">{formatPaise(b.live_final_amount_paise)}</td>
                  <td>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={correct.isPending}
                      onClick={() => {
                        if (confirm(`Write a correction for ${b.patient_name}, billing ${formatPaise(b.live_final_amount_paise)} instead of ${formatPaise(b.final_amount_paise)}?`)) {
                          correct.mutate(b.id)
                        }
                      }}
                    >
                      Correct
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {correct.isError && <p className="form-error">{(correct.error as Error).message}</p>}
    </div>
  )
}
