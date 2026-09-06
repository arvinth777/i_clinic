import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

// v0 is one clinic; a receptionist holds exactly one role row. This takes
// the first clinic_id found rather than assuming which one if that ever
// changes -- see architecture-spec.md's multi-clinic notes.
//
// maybeSingle, not single: a login with no user_roles row at all (added,
// then the role forgotten -- a real production case) legitimately
// returns zero rows here. single() throws on that (PGRST116, a 406);
// every caller already treats a falsy clinicId as "nothing to show yet",
// so resolving to undefined is the correct, quiet outcome.
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
        .maybeSingle()
      if (error) throw error
      return (data?.clinic_id as string | undefined) ?? null
    },
  })
}
