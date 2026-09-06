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

export type ShellSection = { key: string; label: string }

export function AppShell({
  userId,
  userEmail,
  sections,
  activeSection,
  onSelectSection,
  children,
}: {
  userId: string
  userEmail: string | undefined
  sections: ShellSection[]
  activeSection: string
  onSelectSection: (key: string) => void
  children: ReactNode
}) {
  const { data: clinicId } = useClinicId(userId)
  const { data: clinicName } = useClinicName(clinicId)
  const activeLabel = sections.find((s) => s.key === activeSection)?.label ?? ''

  return (
    <div className="shell">
      <div className="shell-sidebar">
        <div className="shell-clinic-name">{clinicName ?? ' '}</div>
        {sections.map((s) => (
          <button
            key={s.key}
            type="button"
            className={s.key === activeSection ? 'shell-nav-item active' : 'shell-nav-item'}
            onClick={() => onSelectSection(s.key)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12l2-2 4 4L19 4l2 2-12 12z" />
            </svg>
            <span>{s.label}</span>
          </button>
        ))}
        <div className="shell-sidebar-foot">
          <span className="shell-user-email">{userEmail}</span>
          <button type="button" className="shell-signout" onClick={() => supabase.auth.signOut()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span className="shell-signout-label">Sign out</span>
          </button>
        </div>
      </div>
      <div className="shell-topbar">
        <span className="shell-topbar-section">{activeLabel}</span>
        <span className="shell-topbar-user">{userEmail}</span>
      </div>
      <div className="shell-content">
        {activeSection ? children : <p>No screen is set up for this account yet.</p>}
      </div>
    </div>
  )
}
