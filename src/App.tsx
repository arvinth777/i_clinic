import { Component, Suspense, lazy, useState, type ReactNode } from 'react'
import { LoadingRows } from './components/QueryState'
import { StagingBanner } from './components/StagingBanner'
import { OfflineQueueBanner } from './components/OfflineQueueBanner'
import { SignIn } from './components/SignIn'
import { AppShell, type ShellSection } from './components/AppShell'
const Patients = lazy(() => import('./pages/Patients').then(module => ({ default: module.Patients })))
const BillingDesk = lazy(() => import('./pages/BillingDesk').then(module => ({ default: module.BillingDesk })))
import { Reception } from './pages/Reception'
import { Consultation } from './pages/Consultation'
const Admin = lazy(() => import('./pages/Admin').then(module => ({ default: module.Admin })))
const PharmacyBills = lazy(() => import('./pages/PharmacyBills').then(module => ({ default: module.PharmacyBills })))
const Stock = lazy(() => import('./pages/Stock').then(module => ({ default: module.Stock })))
const Suppliers = lazy(() => import('./components/stock/Suppliers').then(module => ({ default: module.Suppliers })))
const MergePatients = lazy(() => import('./pages/MergePatients').then(module => ({ default: module.MergePatients })))
const UnpaidBills = lazy(() => import('./pages/UnpaidBills').then(module => ({ default: module.UnpaidBills })))
const LongTermRegister = lazy(() => import('./pages/LongTermRegister').then(module => ({ default: module.LongTermRegister })))
const Reconciliation = lazy(() => import('./pages/Reconciliation').then(module => ({ default: module.Reconciliation })))
const Reports = lazy(() => import('./pages/Reports').then(module => ({ default: module.Reports })))
import { useSession } from './lib/useSession'
import { useUserRoles } from './lib/useUserRoles'

class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <div className="query-error" role="alert"><div><strong>Couldn't open this screen.</strong><p>Reconnect and reload. Pending changes stay on this device.</p></div><button className="ui-button ui-button-neutral" onClick={() => window.location.reload()}>Reload</button></div> : this.props.children
  }
}

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
        <PageLoadBoundary key={activeSection}><Suspense fallback={<LoadingRows label="Opening screen…" />}>
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
        </Suspense></PageLoadBoundary>
      </AppShell>
    </>
  )
}

export default App
