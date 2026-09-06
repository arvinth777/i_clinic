import { useState } from 'react'
import { StagingBanner } from './components/StagingBanner'
import { SignIn } from './components/SignIn'
import { AppShell, type ShellSection } from './components/AppShell'
import { Reception } from './pages/Reception'
import { Consultation } from './pages/Consultation'
import { Admin } from './pages/Admin'
import { Stock } from './pages/Stock'
import { useSession } from './lib/useSession'
import { useUserRoles } from './lib/useUserRoles'

function App() {
  const { session, loading } = useSession()
  const { data: roles } = useUserRoles(session?.user.id)
  const [manualSection, setManualSection] = useState<string | null>(null)

  const sections: ShellSection[] = []
  if (roles?.some((r) => r.role === 'receptionist')) sections.push({ key: 'reception', label: 'Reception' })
  if (roles?.some((r) => r.role === 'doctor')) sections.push({ key: 'consultation', label: 'Consultation' })
  if (roles?.some((r) => r.role === 'doctor' || r.role === 'receptionist')) sections.push({ key: 'stock', label: 'Stock' })
  if (roles?.some((r) => r.role === 'admin')) sections.push({ key: 'admin', label: 'Admin' })

  const clinicId = roles?.[0]?.clinic_id

  // Default to the first section this account can see; a manual click
  // overrides that default without needing to sync it into state.
  const activeSection = manualSection ?? sections[0]?.key ?? ''

  if (loading) return null
  if (!session) {
    return (
      <>
        <StagingBanner />
        <SignIn />
      </>
    )
  }

  return (
    <>
      <StagingBanner />
      <AppShell
        userId={session.user.id}
        userEmail={session.user.email}
        sections={sections}
        activeSection={activeSection}
        onSelectSection={setManualSection}
      >
        {activeSection === 'reception' && <Reception userId={session.user.id} />}
        {activeSection === 'consultation' && <Consultation userId={session.user.id} />}
        {activeSection === 'stock' && clinicId && <Stock clinicId={clinicId} />}
        {activeSection === 'admin' && clinicId && <Admin clinicId={clinicId} />}
      </AppShell>
    </>
  )
}

export default App
