import { ArchiveWorker } from './components/DocumentArchives'
import './Workspace.css'
import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import { LoadingRows } from './components/QueryState'
import { StagingBanner } from './components/StagingBanner'
import { OfflineQueueBanner } from './components/OfflineQueueBanner'
import { SignIn } from './components/SignIn'
import { AppShell, type ShellSection } from './components/AppShell'
import { ConfirmProvider } from './components/ConfirmDialog'
const Patients = lazy(() => import('./pages/Patients').then(module => ({ default: module.Patients })))
const BillingDesk = lazy(() => import('./pages/BillingDesk').then(module => ({ default: module.BillingDesk })))
import { Reception } from './pages/Reception'
import { Consultation } from './pages/Consultation'
const Admin = lazy(() => import('./pages/Admin').then(module => ({ default: module.Admin })))
const PharmacyBills = lazy(() => import('./pages/PharmacyBills').then(module => ({ default: module.PharmacyBills })))
const Stock = lazy(() => import('./pages/Stock').then(module => ({ default: module.Stock })))
const MergePatients = lazy(() => import('./pages/MergePatients').then(module => ({ default: module.MergePatients })))
const UnpaidBills = lazy(() => import('./pages/UnpaidBills').then(module => ({ default: module.UnpaidBills })))
const LongTermRegister = lazy(() => import('./pages/LongTermRegister').then(module => ({ default: module.LongTermRegister })))
const Reconciliation = lazy(() => import('./pages/Reconciliation').then(module => ({ default: module.Reconciliation })))
const Reports = lazy(() => import('./pages/Reports').then(module => ({ default: module.Reports })))
import { useSession } from './lib/useSession'
import { isScreenLocked, setScreenLocked } from './lib/pinLock'
import type { AlertTarget } from './lib/clinicAlerts'
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
  const [manualSection, setManualSection] = useState<string | null>(() => window.location.hash.slice(1).split('/')[0] || null)
  useEffect(() => {
    const restoreSection = () => setManualSection(window.location.hash.slice(1).split('/')[0] || null)
    window.addEventListener('popstate', restoreSection)
    return () => window.removeEventListener('popstate', restoreSection)
  }, [])
  function openSection(section: string) {
    if (window.location.hash !== `#${section}`) window.history.pushState(null, '', `#${section}`)
    setManualSection(section)
  }
  // Owned here, not inside AppShell: OfflineQueueBanner is a sibling of
  // AppShell, not a child, and it needs this same fact to redact a
  // patient's name from a halted-queue message while the screen is
  // locked (docs/STATUS.md's Medium finding) -- a shared source of
  // truth, not two components separately guessing at it.
  const [alertNavigation, setAlertNavigation] = useState(0)
  const [alertTarget, setAlertTarget] = useState<AlertTarget | null>(null)
  const [recordPatientId, setRecordPatientId] = useState<string | null>(null)
  const [locked, setLocked] = useState(isScreenLocked)

  // One short bar per login. Related tools sit inside their page as tabs (group); Settings lives in the profile menu.
  const isDoctor = !!roles?.some(r => r.role === 'doctor'), isReception = !!roles?.some(r => r.role === 'receptionist')
  const isAdmin = !!roles?.some(r => r.role === 'admin')
  const staff = isDoctor || isReception
  const sections: ShellSection[] = []
  if (isReception) sections.push({ key: 'reception', label: 'Queue' })
  if (isDoctor) sections.push({ key: 'consultation', label: 'Consultation' })
  if (staff) sections.push({ key: 'billing', label: 'Billing', tab: 'To collect' })
  if (staff) sections.push({ key: 'pharmacy', label: 'Medicine sale', group: 'billing' })
  if (isReception) sections.push({ key: 'unpaid', label: 'Unpaid bills', group: 'billing' })
  if (staff) sections.push({ key: 'patients', label: 'Patients', tab: 'Everyone' })
  if (staff) sections.push({ key: 'register', label: 'Long-term care', group: 'patients' })
  if (isDoctor) sections.push({ key: 'merge', label: 'Possible duplicates', group: 'patients' })
  if (staff) sections.push({ key: 'stock', label: 'Stock' })
  if (isAdmin || isDoctor) sections.push({ key: 'reports', label: 'Reports', tab: 'Summary' })
  if (isDoctor) sections.push({ key: 'reconciliation', label: 'Needs review', group: 'reports' })
  if (isAdmin || isDoctor) sections.push({ key: 'admin', label: 'Settings', account: true })

  const clinicId = roles?.[0]?.clinic_id

  // Default to the first section this account can see; a manual click
  // overrides that default without needing to sync it into state.
  const activeSection = manualSection && sections.some(s => s.key === manualSection) ? manualSection : isDoctor ? 'consultation' : sections[0]?.key ?? ''

  if (loading || rolesLoading) return null
  if (!session) {
    // Signing in again is itself the unlock. The lock screen's "Sign in again" only cleared the stored flag; this
    // component stays mounted, so the in-memory lock survived and the next sign-in landed back on the lock screen.
    if (locked) { setLocked(false); setScreenLocked(false) }
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
    <ConfirmProvider locked={locked}>
      <StagingBanner />
      {clinicId && <ArchiveWorker clinicId={clinicId} ownerId={session.user.id} locked={locked} />}
      <AppShell key={`${clinicId}:${session.user.id}`}
        userId={session.user.id}
        userEmail={session.user.email}
        isDoctor={!!roles?.some((r) => r.role === 'doctor')}
        locked={locked}
        onLock={() => { setScreenLocked(true); setLocked(true) }}
        onUnlock={() => setLocked(false)}
        sections={sections}
        activeSection={activeSection}
        onSelectSection={openSection}
        onOpenAlert={target => { setAlertNavigation(value => value + 1); setAlertTarget(target); if (target.section === 'patients') setRecordPatientId(target.patientId ?? null); openSection(target.section) }}
      >
        <PageLoadBoundary key={activeSection}><Suspense fallback={<LoadingRows label="Opening screen…" />}>
        {activeSection === 'reception' && <Reception highlightVisitId={alertTarget?.section === 'reception' ? alertTarget.visitId : undefined} userId={session.user.id} readOnly={!roles?.some(r => r.role === 'receptionist')} />}
        {activeSection === 'patients' && clinicId && <Patients key={`${recordPatientId}:${alertNavigation}`} initialTab={alertTarget?.patientTab} highlightVisitId={alertTarget?.section === 'patients' ? alertTarget.visitId : undefined} locked={locked} initialPatientId={recordPatientId} clinicId={clinicId} isDoctor={!!roles?.some(r => r.role === 'doctor')} canBill={!!roles?.some(r => r.role === 'receptionist')} />}
        {activeSection === 'billing' && clinicId && <BillingDesk key={alertNavigation} initialVisitId={alertTarget?.section === 'billing' ? alertTarget.visitId : undefined} clinicId={clinicId} readOnly={!roles?.some(r => r.role === 'receptionist')} />}
        {activeSection === 'unpaid' && clinicId && <UnpaidBills key={alertNavigation} clinicId={clinicId} initialBillId={alertTarget?.section === 'unpaid' ? alertTarget.billId : undefined} />}
        {activeSection === 'consultation' && <Consultation alertNavigation={alertNavigation} requestedVisitId={alertTarget?.section === 'consultation' ? alertTarget.visitId : undefined} userId={session.user.id} onOpenPatient={id=>{setRecordPatientId(id);openSection('patients')}} />}
        {activeSection === 'pharmacy' && clinicId && <PharmacyBills clinicId={clinicId} isDoctor={roles?.some((r) => r.role === 'doctor') ?? false} />}
                {activeSection === 'stock' && clinicId && <Stock key={alertNavigation} highlightMedicineId={alertTarget?.section === 'stock' ? alertTarget.medicineId : undefined} clinicId={clinicId} />}
        {activeSection === 'merge' && clinicId && <MergePatients clinicId={clinicId} />}
        {activeSection === 'register' && clinicId && <LongTermRegister clinicId={clinicId} />}
        {activeSection === 'reconciliation' && clinicId && <Reconciliation clinicId={clinicId} />}
        {activeSection === 'reports' && <Reports />}
        {activeSection === 'admin' && clinicId && <Admin clinicId={clinicId} isAdmin={roles?.some(r=>r.role==='admin')} />}
        </Suspense></PageLoadBoundary>
      </AppShell>
    </ConfirmProvider>
  )
}

export default App
