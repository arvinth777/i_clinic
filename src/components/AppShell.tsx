import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useClinicId } from '../lib/useClinicId'
import './AppShell.css'

function useClinicName(clinicId: string | undefined) {
  return useQuery({
    queryKey: ['clinic-name', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      const { data, error } = await supabase.from('clinics').select('name').eq('id', clinicId).single()
      if (error) throw error
      return data.name as string
    },
  })
}

export function AppShell({
  userId,
  userEmail,
  section,
  children,
}: {
  userId: string
  userEmail: string | undefined
  section: string
  children: ReactNode
}) {
  const { data: clinicId } = useClinicId(userId)
  const { data: clinicName } = useClinicName(clinicId)

  return (
    <div className="shell">
      <div className="shell-sidebar">
        <div className="shell-clinic-name">{clinicName ?? ' '}</div>
        <div className="shell-nav-item">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12l2-2 4 4L19 4l2 2-12 12z" />
          </svg>
          {section}
        </div>
        <div className="shell-sidebar-foot">
          {userEmail}
          <button type="button" className="shell-signout" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
      <div className="shell-topbar">
        <span className="shell-topbar-section">{section}</span>
        <span className="shell-topbar-user">{userEmail}</span>
      </div>
      <div className="shell-content">{children}</div>
    </div>
  )
}
