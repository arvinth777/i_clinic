import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { EMPTY_LEARNING, learn, type HistoryItem, type Learning } from './clinicLearning'

// The last 600 prescribed medicines of the clinic. The raw rows are cached (they persist offline); the suggestions are derived from them.
export function useClinicLearning(clinicId: string): Learning {
  const { data } = useQuery({
    queryKey: ['clinic-learning', clinicId],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('prescription_items')
        .select('medicine_id, drug_type, strength, before_after_food, dosage_frequency, duration_days, prescription_id, medicines(name, molecule_name), prescriptions(diagnosis, advice)')
        .eq('clinic_id', clinicId).order('created_at', { ascending: false }).limit(600)
      if (error) throw error
      return data as unknown as HistoryItem[]
    },
    select: learn,
  })
  return data ?? EMPTY_LEARNING
}
