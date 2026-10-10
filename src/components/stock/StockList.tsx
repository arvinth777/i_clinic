import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Input } from '../ui/input'
import { formatPaise } from '../../lib/money'
import { expiryStatus, formatDateOnly } from '../../lib/date'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Button } from '../ui/button'
import { RecordPurchaseForm } from './RecordPurchaseForm'
import { TransferForm } from './TransferForm'
import { MonthlyCountForm } from './MonthlyCountForm'
import { AdjustStockForm } from './AdjustStockForm'

type Medicine = { id: string; name: string; stock_unit: string | null; price_paise: number; unit_confirmed_at: string | null; low_stock_threshold: number | null; expiry_date: string | null }
type StockPoint = { id: string; name: string }
type StockRow = { medicine_id: string; stock_point_id: string; quantity: number }

export const stockQueryKey = (clinicId: string) => ['stock', clinicId]

type ActionKey = 'purchase' | 'transfer' | 'count' | 'adjust' | null

export function StockList({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const queryKey = stockQueryKey(clinicId)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [action, setAction] = useState<ActionKey>(null)

  const { data: medicines, error: medicineError } = useQuery({
    queryKey: ['medicines-for-stock', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.from('medicines').select('id, name, stock_unit, price_paise, unit_confirmed_at, low_stock_threshold, expiry_date').eq('clinic_id', clinicId).order('name')
      if (error) throw error
      return data as Medicine[]
    },
  })

  const { data: stockPoints, error: pointError } = useQuery({
    queryKey: ['stock-points', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_points').select('id, name').eq('clinic_id', clinicId).order('name')
      if (error) throw error
      return data as StockPoint[]
    },
  })

  const { data: stockRows, error: stockError } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('medicine_stock').select('medicine_id, stock_point_id, quantity').eq('clinic_id', clinicId)
      if (error) throw error
      return data as StockRow[]
    },
  })

  function closeAction() {
    setAction(null)
  }
  function onActionDone() {
    queryClient.invalidateQueries({ queryKey })
    setAction(null)
  }

  function quantityAt(medicineId: string, stockPointId: string): number {
    return stockRows?.find((r) => r.medicine_id === medicineId && r.stock_point_id === stockPointId)?.quantity ?? 0
  }

  const rows = (medicines ?? []).map(m => {
    const total = (stockRows ?? []).filter(r => r.medicine_id === m.id).reduce((sum, r) => sum + r.quantity, 0)
    return { ...m, total, low: m.low_stock_threshold != null && total <= m.low_stock_threshold, expiry: total > 0 ? expiryStatus(m.expiry_date) : null }
  })
  const visible = rows.filter(m => m.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (filter === 'all' || (filter === 'low' ? m.low : !!m.expiry)))
  const labelledMedicines = (medicines ?? []).map((m) => ({ ...m, name: `${m.name} (${m.stock_unit ?? 'unit not confirmed'})` }))

  if (action !== null) {
    const titles: Record<Exclude<ActionKey, null>, string> = {
      purchase: 'Record purchase',
      transfer: 'Transfer stock',
      count: 'Monthly count',
      adjust: 'Adjust stock',
    }
    return (
      <div>
        <button type="button" className="back-to-queue" onClick={closeAction}>
          ← Back to stock
        </button>
        <h2 className="readout-heading">{titles[action]}</h2>
        {action === 'purchase' && (
          <RecordPurchaseForm clinicId={clinicId} medicines={labelledMedicines} stockPoints={stockPoints ?? []} onDone={onActionDone} onCancel={closeAction} />
        )}
        {action === 'transfer' && (
          <TransferForm clinicId={clinicId} medicines={labelledMedicines} stockPoints={stockPoints ?? []} onDone={onActionDone} onCancel={closeAction} />
        )}
        {action === 'count' && (
          <MonthlyCountForm clinicId={clinicId} medicines={labelledMedicines} stockPoints={stockPoints ?? []} onDone={onActionDone} onCancel={closeAction} />
        )}
        {action === 'adjust' && (
          <AdjustStockForm clinicId={clinicId} medicines={labelledMedicines} stockPoints={stockPoints ?? []} onDone={onActionDone} onCancel={closeAction} />
        )}
      </div>
    )
  }

  return <div>
    <div className="flow-stats">
      <div className="flow-stat"><strong className="flow-stat-value">{medicines ? rows.length : '—'}</strong><span className="flow-stat-label">Medicines</span></div>
      <div className="flow-stat"><strong className="flow-stat-value stock-qty-low">{stockRows ? rows.filter(m => m.low).length : '—'}</strong><span className="flow-stat-label">Low stock</span></div>
      <div className="flow-stat"><strong className="flow-stat-value stock-qty-low">{stockRows ? rows.filter(m => m.expiry).length : '—'}</strong><span className="flow-stat-label">Expiry alerts</span></div>
    </div>
    <div className="admin-toolbar">
      <Input aria-label="Search medicines in inventory" placeholder="Search medicines…" value={search} onChange={e => setSearch(e.target.value)} className="inventory-search" />
      <div className="action-row">
        <Button variant="secondary" onClick={() => setAction('adjust')}>Adjust</Button>
        <Button variant="secondary" onClick={() => setAction('count')}>Monthly count</Button>
        <Button variant="secondary" onClick={() => setAction('transfer')}>Transfer</Button>
        <Button onClick={() => setAction('purchase')}>+ Record purchase</Button>
      </div>
    </div>
    <div className="inventory-filters" aria-label="Filter stock">{[['all', 'All medicines'], ['low', 'Low stock'], ['expiry', 'Expiry alerts']].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
    {(medicineError || pointError || stockError) ? <p className="form-error">Couldn't load inventory. Reconnect and try again.</p> : !medicines || !stockRows || !stockPoints ? <p className="readout-empty">Loading inventory…</p> : <>
      <Table><TableHeader><TableRow>
        <TableHead>Medicine</TableHead><TableHead>Unit price</TableHead>
        {stockPoints.map(sp => <TableHead key={sp.id} className="text-right">{sp.name}</TableHead>)}
        <TableHead className="text-right">Total stock</TableHead><TableHead>Expiry</TableHead>
      </TableRow></TableHeader><TableBody>
        {visible.map(m => <TableRow key={m.id}>
          <TableCell><strong>{m.name}</strong><p className="field-hint">{m.unit_confirmed_at ? m.stock_unit : 'Confirm unit and price before billing'}</p></TableCell>
          <TableCell className="tabular-nums">{formatPaise(m.price_paise)}<p className="field-hint">per {m.stock_unit ?? 'unconfirmed unit'}</p></TableCell>
          {stockPoints.map(sp => <TableCell key={sp.id} className={`text-right tabular-nums ${quantityAt(m.id, sp.id) < 0 ? 'stock-qty-negative' : ''}`}>{quantityAt(m.id, sp.id)}</TableCell>)}
          <TableCell className={`text-right tabular-nums ${m.total < 0 ? 'stock-qty-negative' : m.low ? 'stock-qty-low' : ''}`}><strong>{m.total}</strong>{m.low && <p className="field-hint">Low stock</p>}</TableCell>
          <TableCell className={m.expiry ? 'stock-qty-low' : ''}>{m.expiry_date ? formatDateOnly(m.expiry_date) : '—'}{m.expiry && <p className="field-hint">{m.expiry}</p>}</TableCell>
        </TableRow>)}
      </TableBody></Table>
      {!visible.length && <p className="readout-empty">No medicines match this search or filter.</p>}
    </>}
  </div>
}
