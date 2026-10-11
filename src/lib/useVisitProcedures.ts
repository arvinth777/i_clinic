import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export type VisitProcedure = { id: string; procedure_id: string; price_paise: number; procedures: { name: string } | null }

export const visitProceduresKey = (visitId: string) => ['visit-procedures', visitId]

export function useVisitProcedures(visitId: string | undefined) {
  return useQuery({
    queryKey: visitProceduresKey(visitId ?? ''),
    enabled: !!visitId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visit_procedures')
        .select('id, procedure_id, price_paise, procedures(name)')
        .eq('visit_id', visitId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as unknown as VisitProcedure[]
    },
  })
}
