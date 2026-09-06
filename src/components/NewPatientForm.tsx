import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { supabase } from '../lib/supabase'

export type NewPatientInput = {
  name: string
  age: string
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

const emptyForm: NewPatientInput = { name: '', age: '', gender: '', address: '', phone: '', complaint: '', customFields: {} }

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
    if (!form.complaint.trim()) next.complaint = 'Required'
    if (form.phone && !/^\d{10}$/.test(form.phone)) next.phone = 'Must be 10 digits'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    onSubmit(form)
  }

  return (
    <form className="form-panel" onSubmit={handleSubmit}>
      <h2 className="form-heading">New patient</h2>

      <div className="field">
        <label className="field-label" htmlFor="new-name">
          Name
        </label>
        <input id="new-name" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
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
        <input id="new-age" type="number" value={form.age} onChange={(e) => set('age', e.target.value)} />
        {errors.age && (
          <span className="field-error" role="alert">
            {errors.age}
          </span>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="new-gender">
          Gender
        </label>
        <select id="new-gender" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
          <option value="">—</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="new-address">
          Address / Village
        </label>
        <input id="new-address" value={form.address} onChange={(e) => set('address', e.target.value)} />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="new-phone">
          Phone
        </label>
        <input id="new-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
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
        <input id="new-complaint" value={form.complaint} onChange={(e) => set('complaint', e.target.value)} />
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
            <input
              id={`custom-${def.key}`}
              type={def.field_type === 'number' ? 'number' : def.field_type === 'date' ? 'date' : 'text'}
              value={(form.customFields[def.key] as string) ?? ''}
              onChange={(e) => setCustom(def, e.target.value)}
            />
          )}
        </div>
      ))}

      <div className="action-row">
        <motion.button type="submit" className="primary-button" whileTap={{ scale: 0.96, rotate: -1 }} disabled={submitting}>
          {submitting ? 'Checking in…' : 'Check in'}
        </motion.button>
      </div>
    </form>
  )
}
