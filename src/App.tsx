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
import { Reconciliation } from './pages/Reconciliation'
import { Reports } from './pages/Reports'
import { useSession } from './lib/useSession'
import { useUserRoles } from './lib/useUserRoles'

function App() {
  const { session, loading } = useSession()
  const { data: roles, isLoading: rolesLoading } = useUserRoles(session?.user.id)
  const [manualSection, setManualSection] = useState<string | null>(null)
  // Owned here, not inside AppShell: OfflineQueueBanner is a sibling of
  // AppShell, not a child, and it needs this same fact to redact a
  // patient's name from a halted-queue message while the screen is
  // locked (docs/STATUS.md's Medium finding) -- a shared source of
  // truth, not two components separately guessing at it.
  const [locked, setLocked] = useState(false)

  const sections: ShellSection[] = []
  if (roles?.some((r) => r.role === 'receptionist')) sections.push({ key: 'reception', label: 'Reception' })
  if (roles?.some((r) => r.role === 'receptionist')) sections.push({ key: 'unpaid', label: 'Unpaid' })
  if (roles?.some((r) => r.role === 'doctor')) sections.push({ key: 'consultation', label: 'Consultation' })
  if (roles?.some((r) => r.role === 'doctor' || r.role === 'receptionist')) sections.push({ key: 'stock', label: 'Stock' })
  if (roles?.some((r) => r.role === 'doctor')) sections.push({ key: 'merge', label: 'Merge patients' })
  if (roles?.some((r) => r.role === 'doctor' || r.role === 'receptionist')) sections.push({ key: 'register', label: 'Long-term register' })
  if (roles?.some((r) => r.role === 'doctor')) sections.push({ key: 'reconciliation', label: 'Needs reconciliation' })
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
        {/* Requirement 6: unmissable, not just while signed in -- the queue
            isn't cleared on sign-out (docs/STATUS.md's residual edge #2), so
            a receptionist signing out at end of day with pending work still
            needs to see it, not a blank sign-in screen. redact is always
            true here -- nobody unauthenticated sees a halted mutation's
            patient-identifying description (docs/STATUS.md's Medium
            finding). */}
        <OfflineQueueBanner redact />
        <SignIn />
      </>
    )
  }

  return (
    <>
      <StagingBanner />
      <OfflineQueueBanner redact={locked} />
      <AppShell
        userId={session.user.id}
        userEmail={session.user.email}
        isDoctor={!!roles?.some((r) => r.role === 'doctor')}
        locked={locked}
        onLock={() => setLocked(true)}
        onUnlock={() => setLocked(false)}
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
        {activeSection === 'reconciliation' && clinicId && <Reconciliation clinicId={clinicId} />}
        {activeSection === 'reports' && <Reports />}
        {activeSection === 'admin' && clinicId && <Admin clinicId={clinicId} />}
      </AppShell>
    </>
  )
}

export default App
