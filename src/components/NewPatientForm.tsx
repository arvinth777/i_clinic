import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { buttonVariants } from './ui/button'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

export type NewPatientInput = {
  name: string
  age: string
  height: string
  weight: string
  gender: string
  address: string
  phone: string
  complaint: string
  // Keyed by patient_field_definitions.key, already coerced to the JSON
  // shape (number/boolean/string) its field_type calls for -- Admin
  // defines these (Phase A); adding one here needs no code change, only
  // a new row in that table.
  customFields: Record<string, string | number | boolean>
}

type FieldDef = { key: string; label: string; field_type: string }

const emptyForm: NewPatientInput = { name: '', age: '', height: '', weight: '', gender: '', address: '', phone: '', complaint: '', customFields: {} }

export function NewPatientForm({
  clinicId,
  initialName,
  onSubmit,
  submitting,
}: {
  clinicId: string
  initialName: string
  onSubmit: (input: NewPatientInput) => void
  submitting: boolean
}) {
  const [form, setForm] = useState<NewPatientInput>({ ...emptyForm, name: initialName })
  const [errors, setErrors] = useState<Partial<Record<keyof NewPatientInput, string>>>({})

  const { data: fieldDefs } = useQuery({
    queryKey: ['patient-field-definitions', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patient_field_definitions')
        .select('key, label, field_type')
        .eq('clinic_id', clinicId)
        .order('display_order')
      if (error) throw error
      return data as FieldDef[]
    },
  })

  function set<K extends keyof NewPatientInput>(key: K, value: NewPatientInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined })) // a fixed field must stop showing its old error
  }

  function setCustom(def: FieldDef, raw: string | boolean) {
    const value = def.field_type === 'number' ? Number(raw) : def.field_type === 'boolean' ? !!raw : raw
    setForm((f) => ({ ...f, customFields: { ...f.customFields, [def.key]: value } }))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!form.name.trim()) next.name = 'Required'
    if (!form.age.trim()) next.age = 'Required'
    else if (!/^\d{1,3}$/.test(form.age.trim()) || Number(form.age) > 120) next.age = 'Enter a whole number from 0 to 120'
    // Optional; one decimal at most, within what the database accepts (patients_height_range / patients_weight_range).
    const bodyOk = (v: string, lo: number, hi: number) => !v.trim() || (/^\d{1,3}(\.\d)?$/.test(v.trim()) && Number(v) >= lo && Number(v) <= hi)
    if (!bodyOk(form.height, 30, 260)) next.height = 'Enter 30 to 260 cm'
    if (!bodyOk(form.weight, 1, 400)) next.weight = 'Enter 1 to 400 kg'
    if (!form.complaint.trim()) next.complaint = 'Required'
    // People type "98765 43210", "+91-98765-43210" or "098765 43210"; store the 10 digits.
    const phone = form.phone.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '')
    if (phone && !/^\d{10}$/.test(phone)) next.phone = 'Must be 10 digits'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    onSubmit({ ...form, phone })
  }

  return (
    <form className="form-panel" onSubmit={handleSubmit}>
      <h2 className="form-heading">New patient</h2>

      <div className="field">
        <label className="field-label" htmlFor="new-name">
          Name
        </label>
        <Input id="new-name" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        {errors.name && (
          <span className="field-error" role="alert">
            {errors.name}
          </span>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="new-age">
          Age
        </label>
        <Input id="new-age" type="number" min={0} max={120} step={1} value={form.age} onChange={(e) => set('age', e.target.value)} />
        {errors.age && (
          <span className="field-error" role="alert">
            {errors.age}
          </span>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="new-height">
          Height (cm), optional
        </label>
        <Input id="new-height" type="number" inputMode="decimal" min={30} max={260} step={0.1} value={form.height} onChange={(e) => set('height', e.target.value)} />
        {errors.height && (
          <span className="field-error" role="alert">
            {errors.height}
          </span>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="new-weight">
          Weight (kg), optional
        </label>
        <Input id="new-weight" type="number" inputMode="decimal" min={1} max={400} step={0.1} value={form.weight} onChange={(e) => set('weight', e.target.value)} />
        {errors.weight && (
          <span className="field-error" role="alert">
            {errors.weight}
          </span>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="new-gender">
          Gender
        </label>
        <Select value={form.gender} onValueChange={(v) => set('gender', v)}>
          <SelectTrigger id="new-gender">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Male">Male</SelectItem>
            <SelectItem value="Female">Female</SelectItem>
            <SelectItem value="Other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="new-address">
          Address / Village
        </label>
        <Input id="new-address" value={form.address} onChange={(e) => set('address', e.target.value)} />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="new-phone">
          Phone
        </label>
        <Input id="new-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        {errors.phone && (
          <span className="field-error" role="alert">
            {errors.phone}
          </span>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="new-complaint">
          Complaint
        </label>
        <Input id="new-complaint" value={form.complaint} onChange={(e) => set('complaint', e.target.value)} />
        {errors.complaint && (
          <span className="field-error" role="alert">
            {errors.complaint}
          </span>
        )}
      </div>

      {(fieldDefs ?? []).map((def) => (
        <div className="field" key={def.key}>
          <label className="field-label" htmlFor={`custom-${def.key}`}>
            {def.label}
          </label>
          {def.field_type === 'boolean' ? (
            <input
              id={`custom-${def.key}`}
              type="checkbox"
              checked={!!form.customFields[def.key]}
              onChange={(e) => setCustom(def, e.target.checked)}
            />
          ) : (
            <Input
              id={`custom-${def.key}`}
              type={def.field_type === 'number' ? 'number' : def.field_type === 'date' ? 'date' : 'text'}
              value={(form.customFields[def.key] as string) ?? ''}
              onChange={(e) => setCustom(def, e.target.value)}
            />
          )}
        </div>
      ))}

      <div className="action-row">
        <button type="submit" className={buttonVariants({ variant: 'primary' })} data-press="stamp" disabled={submitting}>
          {submitting ? 'Checking in…' : 'Check in'}
        </button>
      </div>
    </form>
  )
}
