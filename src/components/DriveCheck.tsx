import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import './DriveCheck.css'

type Row = { status: string; last_error: string | null }

// One line that says whether a prescription or bill PDF reached Google Drive. The key starts with 'document-archives'
// so the archive worker's invalidation refreshes it the moment an upload finishes.
export function DriveCheck({ clinicId, kind, visitId, billId }: { clinicId: string; kind: 'prescription' | 'receipt'; visitId?: string; billId?: string }) {
  const { data } = useQuery({
    queryKey: ['document-archives', 'check', clinicId, kind, visitId, billId],
    enabled: !!(visitId || billId),
    refetchInterval: query => query.state.data?.status === 'ready' ? false : 10_000,
    queryFn: async () => {
      let request = supabase.from('document_archives').select('status, last_error').eq('clinic_id', clinicId).eq('kind', kind)
      request = billId ? request.eq('bill_id', billId) : request.eq('visit_id', visitId!)
      const { data, error } = await request.order('created_at', { ascending: false }).limit(1)
      if (error) throw error
      return (data?.[0] as Row | undefined) ?? null
    },
  })
  const what = kind === 'receipt' ? 'Bill' : 'Prescription'
  if (!data) return null
  if (data.status === 'ready') return <p className="drive-check drive-check-ok" role="status"><span aria-hidden="true">✓</span> {what} saved to Google Drive</p>
  return <p className="drive-check" role="status"><span aria-hidden="true">…</span> Saving {what.toLowerCase()} to Google Drive{data.last_error ? ' (will retry)' : ''}</p>
}
