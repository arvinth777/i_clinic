import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export type UserRoleRow = { role: string; clinic_id: string }

// One row per (clinic, role) the user holds -- a user can hold more than
// one role at a clinic (the doctor holds {doctor, admin}). v0 is one
// clinic, so callers needing a single clinic_id take the first row's.
export function useUserRoles(userId: string | undefined) {
  return useQuery({
    queryKey: ['user-roles', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_roles').select('role, clinic_id').eq('user_id', userId)
      if (error) throw error
      return data as UserRoleRow[]
    },
  })
}
