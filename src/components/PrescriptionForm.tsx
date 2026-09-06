import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { supabase } from '../lib/supabase'
import { attemptOrQueue } from '../lib/offlineQueue'
import { parseRupeesToPaise } from '../lib/money'
import { newDraftItem, draftFromExisting, itemRow, itemIsValid, type DraftItem, type ExistingItem, type Template } from '../lib/prescriptionDraft'

const DRUG_TYPES = ['Tablet', 'Syrup', 'Capsule', 'Powder', 'Injection', 'Other'] as const
const FOOD_OPTIONS = ['Before food', 'After food', 'Either'] as const
const FREQUENCY_OPTIONS = ['1-0-1', '1-1-1', '0-0-1', '1-0-0', 'SOS', 'Other'] as const

type MedicineResult = { id: string; name: string }

export function PrescriptionForm({
  clinicId,
  visitId,
  lastPrescriptionItems,
  onActiveChange,
}: {
  clinicId: string
  visitId: string
  lastPrescriptionItems: ExistingItem[] | undefined
  onActiveChange: (active: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [reviewOpen, setReviewOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [newMedicinePrice, setNewMedicinePrice] = useState('')

  useEffect(() => {
    onActiveChange(draftItems.length > 0)
  }, [draftItems.length, onActiveChange])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 250)
    return () => clearTimeout(t)
  }, [searchQuery])

  const templatesKey = ['prescription-templates', clinicId]
  const { data: templates } = useQuery({
    queryKey: templatesKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prescription_templates')
        .select(
          'id, name, prescription_template_items(medicine_id, drug_type, strength, before_after_food, dosage_frequency, duration_days, notes, medicines(name))',
        )
        .eq('clinic_id', clinicId)
        .order('name', { ascending: true })
      if (error) throw error
      return data as unknown as Template[]
    },
  })

  const { data: searchResults } = useQuery({
    queryKey: ['medicine-search', clinicId, debouncedSearch],
    enabled: debouncedSearch.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medicines')
        .select('id, name')
        .eq('clinic_id', clinicId)
        .ilike('name', `%${debouncedSearch}%`)
        .order('name', { ascending: true })
        .limit(20)
      if (error) throw error
      return data as MedicineResult[]
    },
  })

  function applyTemplate(template: Template) {
    const items = template.prescription_template_items.map(draftFromExisting).filter((i): i is DraftItem => i !== null)
    setDraftItems((prev) => [...prev, ...items])
  }

  function repeatLast() {
    if (!lastPrescriptionItems) return
    const items = lastPrescriptionItems.map(draftFromExisting).filter((i): i is DraftItem => i !== null)
    setDraftItems((prev) => [...prev, ...items])
  }

  function addFromSearch(medicine: MedicineResult) {
    setDraftItems((prev) => [...prev, newDraftItem(medicine.id, medicine.name)])
    setSearchQuery('')
    setDebouncedSearch('')
  }

  const addNewMedicine = useMutation({
    mutationFn: async (pricePaise: number) => {
      const { data, error } = await supabase
        .from('medicines')
        .insert({ clinic_id: clinicId, name: debouncedSearch, price_paise: pricePaise })
        .select('id, name')
        .single()
      if (error) throw error
      return data as MedicineResult
    },
    onSuccess: (medicine) => {
      addFromSearch(medicine)
      setNewMedicinePrice('')
    },
  })

  function updateDraft(key: string, patch: Partial<DraftItem>) {
    setDraftItems((items) => items.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  }

  function removeDraft(key: string) {
    setDraftItems((items) => items.filter((i) => i.key !== key))
  }

  const canReview = draftItems.length > 0 && draftItems.every(itemIsValid)

  const saveTemplate = useMutation({
    mutationFn: async () => {
      const { data: template, error: templateErr } = await supabase
        .from('prescription_templates')
        .insert({ clinic_id: clinicId, name: templateName.trim() })
        .select('id')
        .single()
      if (templateErr) throw templateErr
      const { error: itemsErr } = await supabase
        .from('prescription_template_items')
        .insert(draftItems.map((item) => ({ ...itemRow(item), clinic_id: clinicId, template_id: template.id })))
      if (itemsErr) throw itemsErr
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templatesKey })
      setTemplateName('')
      setShowSaveTemplate(false)
    },
  })

  const confirm = useMutation({
    // See offlineQueue.ts -- 'online' (the default) would pause this whole
    // mutationFn before it ever runs while offline, never reaching either
    // insert below.
    networkMode: 'always',
    mutationFn: async () => {
      // Client-generated ids, not server-returned ones: with no network,
      // there is no round trip to get an id back from the first insert
      // before the second can reference it. The same id is what makes a
      // queued insert replay-safe (upsert-on-conflict against this id),
      // whichever path (online or queued) each of the two inserts below
      // actually takes.
      const prescriptionId = crypto.randomUUID()
      const itemRows = draftItems.map((item) => ({ ...itemRow(item), id: crypto.randomUUID(), clinic_id: clinicId, prescription_id: prescriptionId }))

      await attemptOrQueue({
        attempt: () => supabase.from('prescriptions').insert({ id: prescriptionId, clinic_id: clinicId, visit_id: visitId }),
        queueItem: () => ({
          kind: 'insert',
          table: 'prescriptions',
          payload: { id: prescriptionId, clinic_id: clinicId, visit_id: visitId },
          description: 'Write a prescription',
        }),
      })
      await attemptOrQueue({
        attempt: () => supabase.from('prescription_items').insert(itemRows),
        queueItem: () => ({ kind: 'insert', table: 'prescription_items', payload: itemRows, description: `Write ${itemRows.length} prescription item(s)` }),
      })
      // Confirming a prescription is not finishing the consultation -- the
      // doctor may still add procedures or set the final amount below.
      // Only the "Consultation done" button (Consultation.tsx) moves the
      // visit to packing; this used to also do it here, which silently
      // ended the consultation the moment a prescription was confirmed,
      // before the doctor ever reached pricing (found via a live flow
      // test, not by inspection -- the visit was already in packing
      // immediately after the confirm click, with final_amount never set).
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['past-prescriptions'] })
      setDraftItems([])
      setReviewOpen(false)
    },
  })

  if (reviewOpen) {
    return (
      <div>
        <ul className="review-list">
          {draftItems.map((item) => (
            <li key={item.key} className="review-item">
              <span className="review-item-name">{item.medicineName}</span>
              <p>
                {[item.drugType, item.strength, item.beforeAfterFood, item.dosageFrequency, `${item.durationDays} days`, `×${item.quantityDispensed}`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {item.notes && <p className="review-item-note">{item.notes}</p>}
            </li>
          ))}
        </ul>
        <div className="action-row">
          <motion.button
            type="button"
            className="secondary-button"
            whileTap={{ scale: 0.97 }}
            disabled={confirm.isPending}
            onClick={() => setReviewOpen(false)}
          >
            Back to edit
          </motion.button>
          <motion.button
            type="button"
            className="primary-button"
            whileTap={{ scale: 0.96, rotate: -1 }}
            disabled={confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending ? 'Confirming…' : 'Confirm prescription'}
          </motion.button>
        </div>
        {confirm.isError && <p className="form-error">Couldn't save — try again.</p>}
      </div>
    )
  }

  return (
    <div>
      {templates && templates.length > 0 && (
        <div className="field">
          <span className="field-label">Templates</span>
          <ul className="search-results">
            {templates.map((t) => (
              <li key={t.id}>
                <button type="button" className="search-result-button" onClick={() => applyTemplate(t)}>
                  <span>{t.name}</span>
                  <span className="search-result-meta">{t.prescription_template_items.length} drug(s)</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="action-row">
        <motion.button
          type="button"
          className="secondary-button"
          whileTap={{ scale: 0.97 }}
          disabled={!lastPrescriptionItems || lastPrescriptionItems.length === 0}
          onClick={repeatLast}
        >
          Repeat last prescription
        </motion.button>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="drug-search">
          Search drugs
        </label>
        <input id="drug-search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Drug name" />
      </div>
      {debouncedSearch &&
        (searchResults && searchResults.length > 0 ? (
          <ul className="search-results">
            {searchResults.map((m) => (
              <li key={m.id}>
                <button type="button" className="search-result-button" onClick={() => addFromSearch(m)}>
                  <span>{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="no-match">
            <p>No drug named "{debouncedSearch}" in the list.</p>
            <div className="field">
              <label className="field-label" htmlFor="new-medicine-price">
                Price (₹)
              </label>
              <input
                id="new-medicine-price"
                inputMode="decimal"
                value={newMedicinePrice}
                onChange={(e) => setNewMedicinePrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <motion.button
              type="button"
              className="secondary-button"
              whileTap={{ scale: 0.97 }}
              disabled={addNewMedicine.isPending || parseRupeesToPaise(newMedicinePrice) === null}
              onClick={() => {
                const price = parseRupeesToPaise(newMedicinePrice)
                if (price !== null) addNewMedicine.mutate(price)
              }}
            >
              {addNewMedicine.isPending ? 'Adding…' : `Add "${debouncedSearch}" as a new drug`}
            </motion.button>
            {addNewMedicine.isError && <p className="form-error">Couldn't add that drug — try again.</p>}
          </div>
        ))}

      {draftItems.length > 0 && (
        <div className="drug-row-list">
          {draftItems.map((item) => (
            <div key={item.key} className="drug-row">
              <div className="drug-row-head">
                <span className="drug-row-name">{item.medicineName}</span>
                <button type="button" className="drug-row-remove" onClick={() => removeDraft(item.key)}>
                  Remove
                </button>
              </div>
              <div className="drug-row-fields">
                <div className="field">
                  <label className="field-label">Type</label>
                  <select value={item.drugType} onChange={(e) => updateDraft(item.key, { drugType: e.target.value })}>
                    {DRUG_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Strength</label>
                  <input value={item.strength} onChange={(e) => updateDraft(item.key, { strength: e.target.value })} placeholder="500mg" />
                </div>
                <div className="field">
                  <label className="field-label">Food</label>
                  <select value={item.beforeAfterFood} onChange={(e) => updateDraft(item.key, { beforeAfterFood: e.target.value })}>
                    {FOOD_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Frequency</label>
                  <select value={item.dosageFrequency} onChange={(e) => updateDraft(item.key, { dosageFrequency: e.target.value })}>
                    {FREQUENCY_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Duration (days)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={item.durationDays}
                    onChange={(e) => updateDraft(item.key, { durationDays: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="field-label">Quantity dispensed</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={item.quantityDispensed}
                    onChange={(e) => updateDraft(item.key, { quantityDispensed: e.target.value })}
                  />
                </div>
                <div className="field drug-row-notes">
                  <label className="field-label">Note</label>
                  <input value={item.notes} onChange={(e) => updateDraft(item.key, { notes: e.target.value })} placeholder="Optional" />
                </div>
              </div>
              {!itemIsValid(item) && <span className="field-error">Type, food, frequency and a whole-number duration are required.</span>}
            </div>
          ))}
        </div>
      )}

      {draftItems.length > 0 && (
        <div className="action-row">
          <motion.button
            type="button"
            className="primary-button"
            whileTap={{ scale: 0.97 }}
            disabled={!canReview}
            onClick={() => setReviewOpen(true)}
          >
            Review prescription
          </motion.button>
          <motion.button
            type="button"
            className="secondary-button"
            whileTap={{ scale: 0.97 }}
            disabled={!canReview}
            onClick={() => setShowSaveTemplate((s) => !s)}
          >
            Save as template
          </motion.button>
        </div>
      )}

      {showSaveTemplate && (
        <form
          className="action-row"
          onSubmit={(e) => {
            e.preventDefault()
            if (templateName.trim()) saveTemplate.mutate()
          }}
        >
          <div className="field comment-field">
            <label className="field-label" htmlFor="template-name">
              Template name
            </label>
            <input
              id="template-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. Standard analgesic set"
            />
          </div>
          <motion.button type="submit" className="secondary-button" whileTap={{ scale: 0.97 }} disabled={saveTemplate.isPending || !templateName.trim()}>
            {saveTemplate.isPending ? 'Saving…' : 'Save'}
          </motion.button>
        </form>
      )}
      {saveTemplate.isError && <p className="form-error">Couldn't save the template — try again.</p>}
    </div>
  )
}
