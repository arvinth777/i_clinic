import { useState } from 'react'
import { DrugList } from '../components/admin/DrugList'
import { ProcedureList } from '../components/admin/ProcedureList'
import { TemplateList } from '../components/admin/TemplateList'
import { CustomFieldList } from '../components/admin/CustomFieldList'
import { LoginsPanel } from '../components/admin/LoginsPanel'
import { ClinicSettings } from '../components/admin/ClinicSettings'
import './Admin.css'

const TABS = [
  { key: 'drugs', label: 'Drugs' },
  { key: 'procedures', label: 'Procedures' },
  { key: 'templates', label: 'Templates' },
  { key: 'fields', label: 'Custom fields' },
  { key: 'logins', label: 'Logins' },
  { key: 'settings', label: 'Settings' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function Admin({ clinicId }: { clinicId: string }) {
  const [tab, setTab] = useState<TabKey>('drugs')

  return (
    <div className="admin-page">
      <nav className="admin-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
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
