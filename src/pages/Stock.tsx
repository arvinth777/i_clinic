import { useState } from 'react'
import { DrugList } from '../components/admin/DrugList'
import { StockList } from '../components/stock/StockList'
import { Suppliers } from '../components/stock/Suppliers'
import './Stock.css'

const TABS = [
  { key: 'stock', label: 'Stock' },
  { key: 'prices', label: 'Medicine units and prices' },
  { key: 'suppliers', label: 'Suppliers' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function Stock({ clinicId }: { clinicId: string }) {
  const [tab, setTab] = useState<TabKey>('stock')

  return (
    <div className="admin-page inventory-page">
      <div className="page-heading"><h1>Inventory</h1><p>Stock goes down automatically when a bill or refill is paid.</p></div>
      <nav className="admin-tabs">
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
        {tab === 'stock' && <StockList clinicId={clinicId} />}
        {tab === 'prices' && <DrugList clinicId={clinicId} pricesOnly />}
        {tab === 'suppliers' && <Suppliers clinicId={clinicId} />}
      </div>
    </div>
  )
}
