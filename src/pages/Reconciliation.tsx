import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatPaise } from '../lib/money'
import { formatDate } from '../lib/date'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { attemptOrQueue } from '../lib/offlineQueue'
import { LoadingRows, QueryError } from '../components/QueryState'
import { Button } from '../components/ui/button'
import { useConfirm } from '../lib/confirm'

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
  live_final_amount_paise: number | null
  confirmed_at: string
}

export function Reconciliation({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const queryKey = ['bills-needing-reconciliation', clinicId]
  const { data: flagged,isPending,error,refetch } = useQuery({
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
    networkMode:'always',
    mutationFn: async (bill:Flagged) => {
      if(bill.live_final_amount_paise===null)throw new Error('Review this legacy bill before correcting it.')
      const args={p_bill_id:bill.id,p_expected_amount_paise:bill.live_final_amount_paise}
      await attemptOrQueue({clinicId,attempt:token=>supabase.rpc('correct_bill',args).setHeader('Authorization',`Bearer ${token}`),queueItem:()=>({kind:'rpc',rpc:'correct_bill',payload:args,description:'Record reviewed bill correction'}),applyOptimistic:()=>queryClient.setQueryData<Flagged[]>(queryKey,old=>old?.filter(b=>b.id!==bill.id))})
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  return (
    <div className="admin-page">
      <div className="admin-toolbar">
        <h2 className="readout-heading">Needs review</h2>
      </div>
      <p className="readout-empty">
        Bills saved while offline, at a price that changed before they synced. Correct issues a corrected bill
        using the supplied quantities and the doctor’s current discount. The original receipt stays as it was.
      </p>
      {error && <QueryError retry={()=>void refetch()} />}
      {isPending ? <LoadingRows label="Loading corrections…" /> : (flagged ?? []).length === 0 ? (
        <p className="readout-empty">Nothing flagged right now.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Billed on</TableHead>
              <TableHead>Billed as</TableHead>
              <TableHead>Actual amount</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(flagged ?? []).map((b) => (
              <TableRow key={b.id}>
                <TableCell className="worklist-name-cell">{b.patient_name}</TableCell>
                <TableCell className="worklist-wait-cell">{b.token_number}</TableCell>
                <TableCell className="worklist-wait-cell">{formatDate(b.confirmed_at)}</TableCell>
                <TableCell className="worklist-wait-cell">{formatPaise(b.final_amount_paise)}</TableCell>
                <TableCell className="worklist-wait-cell">{b.live_final_amount_paise===null?'Review required':formatPaise(b.live_final_amount_paise)}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={correct.isPending || b.live_final_amount_paise===null}
                    onClick={async () => {
                      if (await confirm({ title: `Write a correction for ${b.patient_name}?`, body: `Billing ${b.live_final_amount_paise===null?'Review required':formatPaise(b.live_final_amount_paise)} instead of ${formatPaise(b.final_amount_paise)}.`, confirmLabel: 'Write correction' })) {
                        correct.mutate(b)
                      }
                    }}
                  >
                    Correct
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {correct.isError && <p className="form-error">{(correct.error as Error).message}</p>}
    </div>
  )
}
