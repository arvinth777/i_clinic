import { useState } from 'react'
import { DrugList } from '../components/admin/DrugList'
import { ProcedureList } from '../components/admin/ProcedureList'
import { TemplateList } from '../components/admin/TemplateList'
import { CustomFieldList } from '../components/admin/CustomFieldList'
import { LoginsPanel } from '../components/admin/LoginsPanel'
import { ClinicSettings } from '../components/admin/ClinicSettings'
import './Admin.css'

const TABS = [
  { key: 'drugs', label: 'Medicines & prices' },
  { key: 'procedures', label: 'Procedures' },
  { key: 'templates', label: 'Templates' },
  { key: 'fields', label: 'Custom fields' },
  { key: 'logins', label: 'Staff & access' },
  { key: 'settings', label: 'Clinic information' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function Admin({ clinicId }: { clinicId: string }) {
  const [tab, setTab] = useState<TabKey>('settings')

  return (
    <div className="admin-page settings-page">
      <nav className="admin-tabs" aria-label="Settings"><h2>Settings</h2>
        {TABS.map((t) => (
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
