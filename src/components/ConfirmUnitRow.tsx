import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { setMedicineUnitPrice } from '../lib/offlineQueue'
import { formatPaiseForInput, parseRupeesToPaise } from '../lib/money'
import { Button } from './ui/button'
import { Input } from './ui/input'

// Confirms an existing medicine's billing/stock unit and price without leaving
// the prescription. Same RPC as Stock; the server refuses to change a unit
// that is already confirmed, so this only ever runs for unconfirmed drugs.
export function ConfirmUnitRow({ clinicId, medicineId, name, pricePaise, onDone }: {
  clinicId: string; medicineId: string; name: string; pricePaise?: number | null; onDone: () => void
}) {
  const [unit, setUnit] = useState('')
  const [price, setPrice] = useState(pricePaise ? formatPaiseForInput(pricePaise) : '')
  const paise = parseRupeesToPaise(price)
  const unitInput = useRef<HTMLInputElement>(null), priceInput = useRef<HTMLInputElement>(null)
  const [hint, setHint] = useState('')
  const submit = () => {
    if (!unit.trim()) { setHint('Enter the unit it is sold in (tablet, strip, bottle…).'); unitInput.current?.focus() }
    else if (paise === null) { setHint('Enter the price per unit, for example 2.50.'); priceInput.current?.focus() }
    else { setHint(''); confirm.mutate() }
  }
  const confirm = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      const payload = { p_medicine_id: medicineId, p_stock_unit: unit.trim(), p_price_paise: paise }
      await setMedicineUnitPrice(clinicId, payload, `Confirm unit for ${name}`)
    },
    onSuccess: onDone,
  })
  return (
    <div className="rx-new-medicine">
      <Input ref={unitInput} aria-label={`Billing unit for ${name}`} value={unit} maxLength={24} onChange={(e) => setUnit(e.target.value)} placeholder="tablet, strip, bottle…" />
      <Input ref={priceInput} aria-label={`Unit price (₹) for ${name}`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
      <Button type="button" variant="secondary" disabled={confirm.isPending} onClick={submit}>
        {confirm.isPending ? 'Saving…' : 'Confirm unit'}
      </Button>
      {hint && <p className="form-error" role="alert">{hint}</p>}
      {confirm.isError && <p className="form-error" role="alert">Couldn't confirm the unit — try again.</p>}
    </div>
  )
}
