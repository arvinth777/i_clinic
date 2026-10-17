import { useState } from 'react'
import { DrugList } from '../components/admin/DrugList'
import { ProcedureList } from '../components/admin/ProcedureList'
import { TemplateList } from '../components/admin/TemplateList'
import { CustomFieldList } from '../components/admin/CustomFieldList'
import { LoginsPanel } from '../components/admin/LoginsPanel'
import { ClinicSettings } from '../components/admin/ClinicSettings'
import { QueueSettings } from '../components/admin/QueueSettings'
import { IdleLockSetting } from '../components/admin/IdleLockSetting'

const TABS = [
  { key: 'queue', label: 'Queue' },
  { key: 'drugs', label: 'Medicines & prices' },
  { key: 'procedures', label: 'Procedures' },
  { key: 'templates', label: 'Templates' },
  { key: 'fields', label: 'Custom fields' },
  { key: 'logins', label: 'Staff & access' },
  { key: 'settings', label: 'Clinic information' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function Admin({ clinicId, isAdmin = true }: { clinicId: string; isAdmin?: boolean }) {
  const [tab, setTab] = useState<TabKey>(isAdmin ? 'settings' : 'queue')

  return (
    <div className="admin-page settings-page">
      <nav className="admin-tabs" aria-label="Settings"><h2>Settings</h2>
        {TABS.filter(t=>isAdmin || t.key==='queue').map((t) => (
          <button
            key={t.key}
            type="button"
            aria-current={t.key === tab ? 'page' : undefined}
            className={t.key === tab ? 'shell-nav-item active' : 'shell-nav-item'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="admin-panel">
        {tab === 'queue' && <><QueueSettings clinicId={clinicId} /><IdleLockSetting clinicId={clinicId} /></>}
        {tab === 'drugs' && <DrugList clinicId={clinicId} />}
        {tab === 'procedures' && <ProcedureList clinicId={clinicId} />}
        {tab === 'templates' && <TemplateList clinicId={clinicId} />}
        {tab === 'fields' && <CustomFieldList clinicId={clinicId} />}
        {tab === 'logins' && <LoginsPanel clinicId={clinicId} />}
        {tab === 'settings' && <ClinicSettings clinicId={clinicId} />}
      </div>
    </div>
  )
}
