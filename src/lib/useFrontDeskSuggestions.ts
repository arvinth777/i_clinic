import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { topValues } from './clinicLearning'

// What the front desk types most often (complaints from recent visits, addresses from patient records), for typing suggestions.
export function useFrontDeskSuggestions(clinicId: string) {
  const complaints = useQuery({
    queryKey: ['suggest-complaints', clinicId], enabled: !!clinicId, staleTime: 10 * 60_000,
    queryFn: async () => { const { data, error } = await supabase.from('visits').select('complaint').eq('clinic_id', clinicId).order('arrived_at', { ascending: false }).limit(300); if (error) throw error; return data.map(r => r.complaint as string | null) },
    select: rows => topValues(rows),
  })
  const addresses = useQuery({
    queryKey: ['suggest-addresses', clinicId], enabled: !!clinicId, staleTime: 10 * 60_000,
    queryFn: async () => { const { data, error } = await supabase.from('patients').select('address').eq('clinic_id', clinicId).order('created_at', { ascending: false }).limit(300); if (error) throw error; return data.map(r => r.address as string | null) },
    select: rows => topValues(rows),
  })
  return { complaints: complaints.data ?? [], addresses: addresses.data ?? [] }
}
