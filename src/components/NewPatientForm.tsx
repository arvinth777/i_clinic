import { useEffect, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { bodyOk, HEIGHT_RANGE, WEIGHT_RANGE } from '../lib/patientBody'
import { buttonVariants } from './ui/button'
import { Input } from './ui/input'
import { useFrontDeskSuggestions } from '../lib/useFrontDeskSuggestions'
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
export type ExistingPatient = { id: string; name: string; age: number | null; gender: string | null; phone: string | null; address: string | null }

const emptyForm: NewPatientInput = { name: '', age: '', height: '', weight: '', gender: '', address: '', phone: '', complaint: '', customFields: {} }

export function NewPatientForm({
  clinicId,
  initialName,
  onSubmit,
  onUseExisting,
  submitting,
}: {
  clinicId: string
  initialName: string
  onSubmit: (input: NewPatientInput) => void
  onUseExisting: (patient: ExistingPatient) => void
  submitting: boolean
}) {
  const [form, setForm] = useState<NewPatientInput>({ ...emptyForm, name: initialName })
  const suggestions = useFrontDeskSuggestions(clinicId)
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

  // Catch a repeat registration while it is being typed: the same 10-digit phone, or a name of 3+ letters.
  const typedPhone = form.phone.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '')
  const lookup = /^\d{10}$/.test(typedPhone) ? typedPhone : form.name.trim().length >= 3 ? form.name.trim() : ''
  const [debouncedLookup, setDebouncedLookup] = useState('')
  useEffect(() => { const t = setTimeout(() => setDebouncedLookup(lookup), 400); return () => clearTimeout(t) }, [lookup])
  const { data: similar } = useQuery({
    queryKey: ['new-patient-similar', clinicId, debouncedLookup],
    enabled: debouncedLookup.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_patients', { p_clinic_id: clinicId, p_query: debouncedLookup })
      if (error) throw error
      return (data as ExistingPatient[]).slice(0, 3)
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
    if (!bodyOk(form.height, ...HEIGHT_RANGE)) next.height = 'Enter 30 to 260 cm'
    if (!bodyOk(form.weight, ...WEIGHT_RANGE)) next.weight = 'Enter 1 to 400 kg'
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
      {debouncedLookup === lookup && (similar?.length ?? 0) > 0 && (
        <div className="similar-patients" role="status">
          <p className="field-hint">Already registered? Use the existing record instead of making a second one.</p>
          <ul>{similar!.map(p => <li key={p.id}><span>{p.name}<span className="search-result-meta">{p.age ? ` · ${p.age}y` : ''}{p.phone ? ` · ${p.phone}` : ''}</span></span><button type="button" className="shell-nav-item" onClick={() => onUseExisting(p)}>Use this patient</button></li>)}</ul>
        </div>
      )}

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
        <Input id="new-height" type="number" inputMode="decimal" min={HEIGHT_RANGE[0]} max={HEIGHT_RANGE[1]} step={0.1} value={form.height} onChange={(e) => set('height', e.target.value)} />
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
        <Input id="new-weight" type="number" inputMode="decimal" min={WEIGHT_RANGE[0]} max={WEIGHT_RANGE[1]} step={0.1} value={form.weight} onChange={(e) => set('weight', e.target.value)} />
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
        <Input id="new-address" list="new-address-suggestions" value={form.address} onChange={(e) => set('address', e.target.value)} />
        <datalist id="new-address-suggestions">{suggestions.addresses.map(value => <option key={value} value={value} />)}</datalist>
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
        <Input id="new-complaint" list="new-complaint-suggestions" value={form.complaint} onChange={(e) => set('complaint', e.target.value)} />
        <datalist id="new-complaint-suggestions">{suggestions.complaints.map(value => <option key={value} value={value} />)}</datalist>
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
