import { useState } from 'react'
import { StagingBanner } from './components/StagingBanner'
import { OfflineQueueBanner } from './components/OfflineQueueBanner'
import { SignIn } from './components/SignIn'
import { AppShell, type ShellSection } from './components/AppShell'
import { Patients } from './pages/Patients'
import { BillingDesk } from './pages/BillingDesk'
import { Reception } from './pages/Reception'
import { Consultation } from './pages/Consultation'
import { Admin } from './pages/Admin'
import { PharmacyBills } from './pages/PharmacyBills'
import { Stock } from './pages/Stock'
import { Suppliers } from './components/stock/Suppliers'
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
  const [recordPatientId, setRecordPatientId] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)

  const sections: ShellSection[] = []
  if (roles?.some((r) => r.role === 'receptionist' || r.role === 'doctor')) sections.push({ key: 'reception', label: 'Reception' })
  if (roles?.some((r) => r.role === 'receptionist')) sections.push({ key: 'unpaid', label: 'Unpaid bills' })
  if (roles?.some((r) => r.role === 'receptionist' || r.role === 'doctor')) sections.push({ key: 'billing', label: 'Billing' })
  if (roles?.some((r) => r.role === 'doctor')) sections.push({ key: 'consultation', label: 'Doctor' })
  if (roles?.some((r) => r.role === 'doctor' || r.role === 'receptionist')) sections.push({ key: 'patients', label: 'Patients' })
  if (roles?.some((r) => r.role === 'doctor' || r.role === 'receptionist')) sections.push({ key: 'stock', label: 'Inventory' })
  if (roles?.some((r) => r.role === 'doctor' || r.role === 'receptionist')) sections.push({ key: 'pharmacy', label: 'Refills' })
  if (roles?.some((r) => r.role === 'doctor')) sections.push({ key: 'merge', label: 'Merge patients' })
  // Renamed from "Long-term register" -- the user asked directly what
  // it even meant; "register" (a records-office word) was the jargon,
  // not the underlying feature (patients flagged for periodic review).
  if (roles?.some((r) => r.role === 'doctor' || r.role === 'receptionist')) sections.push({ key: 'register', label: 'Long-term care' })
  if (roles?.some((r) => r.role === 'doctor')) sections.push({ key: 'reconciliation', label: 'Needs reconciliation' })
  if (roles?.some((r) => r.role === 'admin' || r.role === 'doctor')) sections.push({ key: 'reports', label: 'Reports' })
  if (roles?.some((r) => r.role === 'admin' || r.role === 'doctor')) sections.push({ key: 'admin', label: 'Settings' })

  if (roles?.some(r => r.role === 'doctor' || r.role === 'receptionist')) sections.push({ key: 'suppliers', label: 'Suppliers' })

  const clinicId = roles?.[0]?.clinic_id

  // Default to the first section this account can see; a manual click
  // overrides that default without needing to sync it into state.
  const activeSection = manualSection && (manualSection === 'more' || sections.some(s => s.key === manualSection)) ? manualSection : roles?.some(r => r.role === 'doctor') ? 'consultation' : sections[0]?.key ?? ''

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
        {activeSection === 'reception' && <Reception userId={session.user.id} readOnly={!roles?.some(r => r.role === 'receptionist')} />}
        {activeSection === 'patients' && clinicId && <Patients initialPatientId={recordPatientId} clinicId={clinicId} isDoctor={!!roles?.some(r => r.role === 'doctor')} canBill={!!roles?.some(r => r.role === 'receptionist')} />}
        {activeSection === 'billing' && clinicId && <BillingDesk clinicId={clinicId} readOnly={!roles?.some(r => r.role === 'receptionist')} />}
        {activeSection === 'unpaid' && clinicId && <UnpaidBills clinicId={clinicId} />}
        {activeSection === 'consultation' && <Consultation userId={session.user.id} onOpenPatient={id=>{setRecordPatientId(id);setManualSection('patients')}} />}
        {activeSection === 'pharmacy' && clinicId && <PharmacyBills clinicId={clinicId} isDoctor={roles?.some((r) => r.role === 'doctor') ?? false} />}
        {activeSection === 'suppliers' && clinicId && <Suppliers clinicId={clinicId} />}
        {activeSection === 'stock' && clinicId && <Stock clinicId={clinicId} />}
        {activeSection === 'merge' && clinicId && <MergePatients clinicId={clinicId} />}
        {activeSection === 'register' && clinicId && <LongTermRegister clinicId={clinicId} />}
        {activeSection === 'reconciliation' && clinicId && <Reconciliation clinicId={clinicId} />}
        {activeSection === 'reports' && <Reports />}
        {activeSection === 'admin' && clinicId && <Admin clinicId={clinicId} isAdmin={roles?.some(r=>r.role==='admin')} />}
      </AppShell>
    </>
  )
}

export default App
