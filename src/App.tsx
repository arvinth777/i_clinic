import { useState } from 'react'
import { StagingBanner } from './components/StagingBanner'
import { OfflineQueueBanner } from './components/OfflineQueueBanner'
import { SignIn } from './components/SignIn'
import { AppShell, type ShellSection } from './components/AppShell'
import { Reception } from './pages/Reception'
import { Consultation } from './pages/Consultation'
import { Admin } from './pages/Admin'
import { Stock } from './pages/Stock'
import { MergePatients } from './pages/MergePatients'
import { UnpaidBills } from './pages/UnpaidBills'
import { LongTermRegister } from './pages/LongTermRegister'
import { Reports } from './pages/Reports'
import { useSession } from './lib/useSession'
import { useUserRoles } from './lib/useUserRoles'

function App() {
  const { session, loading } = useSession()
  const { data: roles, isLoading: rolesLoading } = useUserRoles(session?.user.id)
  const [manualSection, setManualSection] = useState<string | null>(null)

  const sections: ShellSection[] = []
  if (roles?.some((r) => r.role === 'receptionist')) sections.push({ key: 'reception', label: 'Reception' })
  if (roles?.some((r) => r.role === 'receptionist')) sections.push({ key: 'unpaid', label: 'Unpaid' })
  if (roles?.some((r) => r.role === 'doctor')) sections.push({ key: 'consultation', label: 'Consultation' })
  if (roles?.some((r) => r.role === 'doctor' || r.role === 'receptionist')) sections.push({ key: 'stock', label: 'Stock' })
  if (roles?.some((r) => r.role === 'doctor')) sections.push({ key: 'merge', label: 'Merge patients' })
  if (roles?.some((r) => r.role === 'doctor' || r.role === 'receptionist')) sections.push({ key: 'register', label: 'Long-term register' })
  if (roles?.some((r) => r.role === 'admin' || r.role === 'doctor')) sections.push({ key: 'reports', label: 'Reports' })
  if (roles?.some((r) => r.role === 'admin')) sections.push({ key: 'admin', label: 'Admin' })

  const clinicId = roles?.[0]?.clinic_id

  // Default to the first section this account can see; a manual click
  // overrides that default without needing to sync it into state.
  const activeSection = manualSection ?? sections[0]?.key ?? ''

  if (loading || rolesLoading) return null
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
      <OfflineQueueBanner />
      <AppShell
        userId={session.user.id}
        userEmail={session.user.email}
        sections={sections}
        activeSection={activeSection}
        onSelectSection={setManualSection}
      >
        {activeSection === 'reception' && <Reception userId={session.user.id} />}
        {activeSection === 'unpaid' && clinicId && <UnpaidBills clinicId={clinicId} />}
        {activeSection === 'consultation' && <Consultation userId={session.user.id} />}
        {activeSection === 'stock' && clinicId && <Stock clinicId={clinicId} />}
        {activeSection === 'merge' && clinicId && <MergePatients clinicId={clinicId} />}
        {activeSection === 'register' && clinicId && <LongTermRegister clinicId={clinicId} />}
        {activeSection === 'reports' && <Reports />}
        {activeSection === 'admin' && clinicId && <Admin clinicId={clinicId} />}
      </AppShell>
    </>
  )
}

export default App
