import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useClinicId } from '../lib/useClinicId'
import { useTheme } from '../lib/useTheme'
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
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="shell">
      <div className="shell-header">
        <span className="shell-clinic-name">{clinicName ?? ' '}</span>
        {sections.length > 0 && (
          <nav className="shell-nav">
            {sections.map((s) => (
              <button
                key={s.key}
                type="button"
                className={s.key === activeSection ? 'shell-nav-item active' : 'shell-nav-item'}
                onClick={() => onSelectSection(s.key)}
              >
                {s.label}
              </button>
            ))}
          </nav>
        )}
        <div className="shell-header-spacer" />
        <button
          type="button"
          className="shell-theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
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
      <div className="shell-content">
        {activeSection ? children : <p>No screen is set up for this account yet.</p>}
      </div>
    </div>
  )
}
