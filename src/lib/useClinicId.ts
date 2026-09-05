import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

// v0 is one clinic; a receptionist holds exactly one role row. This takes
// the first clinic_id found rather than assuming which one if that ever
// changes -- see architecture-spec.md's multi-clinic notes.
export function useClinicId(userId: string | undefined) {
  return useQuery({
    queryKey: ['clinic-id', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('clinic_id')
        .eq('user_id', userId)
        .limit(1)
        .single()
      if (error) throw error
      return data.clinic_id as string
    },
  })
}
