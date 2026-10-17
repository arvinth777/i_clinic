import { usePrintDocument } from '../lib/usePrintDocument'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { mergePrescriptionPrint, readPrescriptionPrint, savePrescriptionPrint, readPrescriptionDraft, savePrescriptionDraft } from '../lib/prescriptionPrint'
import { PrintablePrescription, type PrintVisit, type ClinicPrintInfo, type DetailRow } from './VisitPrintout'
import { LetterheadPreview } from './LetterheadPreview'
import './PrescriptionForm.css'
import { attemptOrQueue } from '../lib/offlineQueue'
import { changeProposal, type PricingProposal } from '../lib/pricingProposal'
import { Button, buttonVariants } from './ui/button'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import {
  newDraftItem,
  draftFromExisting,
  itemRow,
  itemIsValid,
  usualCombo,
  suggestedQuantity,
  prescribedUnit,
  type DraftItem,
  type PastPrescription,
  type Template,
} from '../lib/prescriptionDraft'

const DRUG_TYPES = ['Tablet', 'Syrup', 'Capsule', 'Powder', 'Injection', 'Topical', 'Other'] as const
const FOOD_OPTIONS = ['Before food', 'After food', 'Either'] as const
const FREQUENCY_OPTIONS = ['1-0-1', '1-1-1', '0-0-1', '1-0-0', 'SOS'] as const

type MedicineResult = { id: string; name: string; molecule_name?: string | null; stock_unit?: string | null; unit_confirmed_at?: string | null; price_paise?: number | null }

export function PrescriptionForm({
  clinicId,
  visitId,
  userId,
  visit,
  pastPrescriptions,
  onActiveChange,
  children,
}: {
  clinicId: string
  visitId: string
  userId: string
  visit: PrintVisit
  pastPrescriptions: PastPrescription[] | undefined
  children?: ReactNode
  onActiveChange: (active: boolean) => void
}) {
  const print = usePrintDocument(`${clinicId}:${visitId}`)
  const queryClient = useQueryClient()
  const printKey = ['prescription-print', userId, clinicId, visitId]
  const { data: printed } = useQuery({ queryKey: printKey, queryFn: async () => (await readPrescriptionPrint(userId, clinicId, visitId)) ?? null })
  const { data: clinic } = useQuery({
    queryKey: ['clinic-print-info', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clinics').select('name, upi_vpa, doctor_name, doctor_registration_number, address, phone').eq('id', clinicId).single()
      if (error) throw error
      return data as ClinicPrintInfo
    },
  })
  const confirmationId = useRef<string | null>(null)
  const newMedicineIdentity = useRef<{ id: string; name: string } | null>(null)
  const [diagnosis, setDiagnosis] = useState('')
  const [advice, setAdvice] = useState('')
  const { data: followUp } = useQuery({ queryKey: ['visit-follow-up', visitId], queryFn: async () => {
    const { data, error } = await supabase.from('visits').select('follow_up_date').eq('id', visitId).single()
    if (error) throw error
    return data as { follow_up_date: string | null }
  } })
  const [closedRows, setClosedRows] = useState<string[]>([])
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [draftStorageError, setDraftStorageError] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')

  useEffect(() => {
    if (!printed || !followUp || printed.visit.follow_up_date === followUp.follow_up_date) return
    const updated = { ...printed, visit: { ...printed.visit, follow_up_date: followUp.follow_up_date } }
    savePrescriptionPrint(userId, clinicId, updated).then(() => queryClient.setQueryData(printKey, updated)).catch(() => setDraftStorageError(true))
    // Keys are derived from the same owner, clinic and visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printed, followUp, userId, clinicId, visitId, queryClient])
  useEffect(() => {
    let active = true
    readPrescriptionDraft(userId, clinicId, visitId).then(draft => {
      if (!active) return
      // A draft saved before stockUnit existed has none: default it so nothing downstream calls .trim() on undefined.
      if (draft) { setDraftItems(draft.items.map(item => ({ ...item, stockUnit: item.stockUnit ?? '' }))); setDiagnosis(draft.diagnosis); setAdvice(draft.advice) }
      setDraftLoaded(true)
    }).catch(() => { if (active) setDraftStorageError(true) })
    return () => { active = false }
  }, [userId, clinicId, visitId])
  useEffect(() => {
    if (!draftLoaded) return
    savePrescriptionDraft(userId, clinicId, visitId, { items: draftItems, diagnosis, advice })
      .then(() => setDraftStorageError(false)).catch(() => setDraftStorageError(true))
  }, [draftLoaded, draftItems, diagnosis, advice, userId, clinicId, visitId])
  useEffect(() => {
    if (!draftItems.length && !diagnosis && !advice) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [draftItems.length, diagnosis, advice])

  useEffect(() => {
    onActiveChange(draftItems.length > 0 || !!diagnosis || !!advice)
  }, [draftItems.length, diagnosis, advice, onActiveChange])

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
      const base = () => supabase.from('medicines').select('id, name, molecule_name, stock_unit, unit_confirmed_at, price_paise').eq('clinic_id', clinicId).eq('is_active', true).order('name', { ascending: true }).limit(20)
      const [byName, byMolecule] = await Promise.all([base().ilike('name', `%${debouncedSearch}%`), base().ilike('molecule_name', `%${debouncedSearch}%`)])
      if (byName.error) throw byName.error
      if (byMolecule.error) throw byMolecule.error
      return [...new Map([...(byName.data ?? []), ...(byMolecule.data ?? [])].map(row => [row.id, row])).values()] as MedicineResult[]
    },
  })

  const { data: medicineUnits } = useQuery({
    queryKey: ['prescription-medicine-units', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.from('medicines').select('id, stock_unit, price_paise, unit_confirmed_at, is_active').eq('clinic_id', clinicId)
      if (error) throw error
      return data as { id: string; stock_unit: string | null; price_paise:number; unit_confirmed_at: string | null; is_active: boolean }[]
    },
  })

  // Quick-add excludes retired catalog rows and duplicates.
  const [skipNote, setSkipNote] = useState('')
  function addQuick(candidates: DraftItem[]) {
    const active = (id: string) => !medicineUnits || !!medicineUnits.find((m) => m.id === id && m.is_active)
    // Filter against `prev`, not the render's draftItems: two clicks before a re-render must not both add.
    setDraftItems((prev) => {
      const have = new Set(prev.map((i) => i.medicineId))
      return [...prev, ...candidates.filter((i) => !have.has(i.medicineId) && active(i.medicineId))]
    })
    const duplicates = candidates.filter((i) => draftItems.some((d) => d.medicineId === i.medicineId)).length
    setSkipNote(duplicates ? `${duplicates} already on this prescription` : '')
  }

  function applyTemplate(template: Template) {
    addQuick(template.prescription_template_items.map(draftFromExisting).filter((i): i is DraftItem => i !== null))
  }

  // Majority of the patient's last 5 prescriptions, not just the most
  // recent one -- see usualCombo's own header for why. Computed directly
  // each render: cheap (at most 5 prescriptions' worth of items), no
  // memoisation needed.
  const combo = usualCombo(pastPrescriptions ?? [])

  function applyCombo() {
    addQuick(combo.map((c) => draftFromExisting(c.item)).filter((i): i is DraftItem => i !== null))
  }

  function addFromSearch(medicine: MedicineResult) {
    setDraftItems((prev) => [...prev, newDraftItem(medicine.id, medicine.molecule_name || medicine.name, medicine.stock_unit)])
    setSearchQuery('')
    setDebouncedSearch('')
  }

  const addNewMedicine = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      if (newMedicineIdentity.current?.name !== debouncedSearch) newMedicineIdentity.current = { id: crypto.randomUUID(), name: debouncedSearch }
      const row = { ...newMedicineIdentity.current!, molecule_name: debouncedSearch, clinic_id: clinicId, price_paise: 0 }
      await attemptOrQueue({ clinicId,
        attempt: (token) => supabase.from('medicines').upsert(row, { onConflict: 'id', ignoreDuplicates: true }).setHeader('Authorization', `Bearer ${token}`),
        queueItem: () => ({ kind: 'insert', table: 'medicines', payload: row, description: 'Add medicine' }),
      })
      return { id: row.id, name: row.name, molecule_name: row.molecule_name, stock_unit: null } as MedicineResult
    },
    onSuccess: (medicine) => {
      addFromSearch(medicine)
      newMedicineIdentity.current = null
      queryClient.invalidateQueries({ queryKey: ['medicine-search', clinicId] })
      queryClient.invalidateQueries({ queryKey: ['prescription-medicine-units', clinicId] })
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
      // A template stores what to prescribe, not how many to supply: prescription_template_items has no quantity column.
      const { error: itemsErr } = await supabase
        .from('prescription_template_items')
        .insert(draftItems.map((item) => { const { quantity_dispensed: _quantity, ...row } = itemRow(item); return { ...row, clinic_id: clinicId, template_id: template.id } }))
      if (itemsErr) {
        await supabase.from('prescription_templates').delete().eq('id', template.id) // never leave an empty template behind
        throw itemsErr
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templatesKey })
      setTemplateName('')
      setShowSaveTemplate(false)
    },
  })

  const confirm = useMutation({
    // See offlineQueue.ts -- 'online' (the default) would pause this whole
    // mutationFn before it ever runs while offline, never reaching the queue.
    networkMode: 'always',
    mutationFn: async () => {
      const prescriptionId = confirmationId.current ??= crypto.randomUUID()
      const itemRows = draftItems.map((item) => ({ ...itemRow(item), stock_unit: item.drugType === 'Other' ? item.stockUnit.trim().toLowerCase() : prescribedUnit(item.drugType), id: item.key }))
      const previous = await readPrescriptionPrint(userId, clinicId, visitId)
      const existing = (pastPrescriptions ?? []).filter((prescription) => prescription.visit_id === visitId)
      const previousMedicines: DetailRow[] = previous?.medicines ?? existing.flatMap((prescription) => prescription.prescription_items.map((item) => ({
        ...item, prescription_id: prescription.id, before_after_food: item.before_after_food ?? null,
        kind: 'medicine', description: item.medicines?.name ?? 'Medicine', unit_price_paise: 0,
      })))
      const previousIds = previous?.prescriptionIds ?? existing.map((prescription) => prescription.id)
      const medicines: DetailRow[] = draftItems.map((item) => ({
        ...itemRow(item), prescription_id: prescriptionId, kind: 'medicine', description: item.medicineName, unit_price_paise: 0,
      }))
      const snapshot = mergePrescriptionPrint({ visit, medicines: previousMedicines, prescriptionIds: previousIds }, {
        visit: { ...visit, prescribed_at: previous?.visit.prescribed_at ?? new Date().toISOString(), diagnosis, advice, follow_up_date: followUp?.follow_up_date }, clinic: clinic ?? previous?.clinic,
        medicines, prescriptionIds: [prescriptionId],
      })
      // Retain reviewed instructions before the network call, including a crash during save.
      await savePrescriptionPrint(userId, clinicId, snapshot)
      queryClient.setQueryData(printKey, snapshot)
      const payload = { p_prescription_id: prescriptionId, p_visit_id: visitId, p_items: itemRows, p_diagnosis: diagnosis, p_advice: advice }
      await attemptOrQueue({
        clinicId,
        attempt: (accessToken) => supabase.rpc('save_prescription', payload).setHeader('Authorization', `Bearer ${accessToken}`),
        queueItem: () => ({ kind: 'rpc', rpc: 'save_prescription', payload, description: 'Save prescription instructions' }),
        applyOptimistic:()=>{
          queryClient.setQueryData<PricingProposal|null>(['pricing-proposal',visitId],old=>changeProposal(old,lines=>[...lines,...itemRows.map(item=>{
            const medicine=medicineUnits?.find(m=>m.id===item.medicine_id)
            return {...item,kind:'medicine',prescription_item_id:item.id,quantity:item.quantity_dispensed,stock_unit:medicine?.stock_unit ?? item.stock_unit,unit_price_paise:medicine?.price_paise??0}
          })]))
          queryClient.setQueryData(['visit-pricing',visitId],(old:Record<string,unknown>|undefined)=>old?{...old,final_amount_set:false}:old)
        },
      })
    },
    onSuccess: () => {
      confirmationId.current = null
      queryClient.invalidateQueries({ queryKey: ['past-prescriptions'] })
      queryClient.invalidateQueries({queryKey:['pricing-proposal',visitId]})
      queryClient.invalidateQueries({queryKey:['visit-pricing',visitId]})
      setDraftItems([])
      setDiagnosis('')
      setAdvice('')
      setReviewOpen(false)
    },
  })

  const existingMedicines: DetailRow[] = (pastPrescriptions ?? []).filter(p => p.visit_id === visitId).flatMap(p => p.prescription_items.map(item => ({ ...item, before_after_food: item.before_after_food ?? null, kind: 'medicine', description: item.medicines?.name ?? 'Medicine', unit_price_paise: 0 })))
  const previewVisit = draftItems.length || diagnosis || advice ? { ...visit, diagnosis, advice, follow_up_date: followUp?.follow_up_date } : printed?.visit ?? visit
  const previewMedicines: DetailRow[] = draftItems.length ? draftItems.map(item => ({
    ...itemRow(item), kind: 'medicine', description: item.medicineName, unit_price_paise: 0,
  })) : printed?.medicines ?? existingMedicines
  const preview = <LetterheadPreview><PrintablePrescription clinic={clinic ?? printed?.clinic} visit={previewVisit} medicines={previewMedicines} /></LetterheadPreview>

  if (!draftLoaded) return <p className={draftStorageError ? 'form-error' : 'field-hint'}>{draftStorageError ? 'Could not read the saved draft. Reload before editing so it is not overwritten.' : 'Loading saved prescription…'}</p>

  if (reviewOpen) {
    return (
      <div className="rx-workspace"><div className="rx-editor">
        <h3 className="readout-heading">Review prescription</h3>
        <ul className="review-list">
          {draftItems.map((item) => (
            <li key={item.key} className="review-item">
              <span className="review-item-name">{item.medicineName}</span>
              <p>
                {[item.drugType, item.strength, item.beforeAfterFood, item.dosageFrequency, `For ${item.durationDays} days`, `×${item.quantityDispensed}`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {item.notes && <p className="review-item-note">{item.notes}</p>}
            </li>
          ))}
        </ul>
        {advice && <p>Advice: {advice}</p>}
        {diagnosis ? <p>Diagnosis: {diagnosis}</p> : <p className="rx-reminder" role="status">Diagnosis is missing. You can still issue this prescription.</p>}
        {!followUp?.follow_up_date && <p className="rx-reminder" role="status">Review date is missing. Set it under Long-term care if needed.</p>}
        <div className="action-row">
          <Button type="button" variant="secondary" disabled={confirm.isPending} onClick={() => setReviewOpen(false)}>
            Back to edit
          </Button>
          <button
            type="button"
            className={buttonVariants({ variant: 'primary' })}
            data-press="stamp"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending ? 'Confirming…' : 'Confirm prescription'}
          </button>
        </div>
        {print.isError && <p className="form-error" role="alert">{print.error.message}</p>}
      {confirm.isError && <p className="form-error" role="alert">Couldn't save: {confirm.error instanceof Error || (confirm.error && 'message' in confirm.error) ? String((confirm.error as { message: string }).message) : 'try again'}</p>}
      </div>{preview}</div>
    )
  }

  const hasQuickAdd = combo.length > 0 || (templates && templates.length > 0)

  return (
    <div className="rx-workspace"><div className="rx-editor">
      {draftStorageError && <p className="form-error" role="alert">Draft not saved on this device. Keep this page open and retry before leaving.</p>}
      {(draftItems.length > 0 || diagnosis || advice) && <p className="field-hint" role="status">Draft on this device · not issued yet</p>}
      <div className="rx-patient"><h2>{visit.patients?.name}</h2><p>{[visit.patients?.age != null ? `${visit.patients.age} years` : '', visit.patients?.gender, `Token #${visit.token_number}`].filter(Boolean).join(' · ')}</p></div>
      <p className="field-hint rx-complaint">From reception · {visit.complaint || 'No complaint recorded'}</p>
      {printed && (
        <>
          <Button type="button" variant="secondary" disabled={print.isPending} onClick={() => print.mutate()}>Print prescription</Button>
          <div className="print-area"><PrintablePrescription clinic={printed.clinic} visit={printed.visit} medicines={printed.medicines} /></div>
        </>
      )}
      {print.isError && <p className="form-error" role="alert">{print.error.message}</p>}
      {confirm.isError && <p className="form-error">Not saved yet — the local print copy is available. Fix the problem above, then retry.</p>}
      <div className="field search-results-anchor">
        <label className="field-label" htmlFor="drug-search">
          Medicines
        </label>
        <Input
          id="drug-search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Add a medicine or a saved set…"
          onKeyDown={e => { if (e.key === 'Enter' && searchResults?.[0]) { e.preventDefault(); addFromSearch(searchResults[0]) } }}
        />
      </div>

      {hasQuickAdd && (
        <div className="rx-quick-add">
          <span className="rx-quick-add-label">Quick add:</span>
          {combo.length > 0 && (
            <button type="button" className="rx-chip rx-chip-suggested" onClick={applyCombo}>
              Usual combo: {combo.map((c) => c.medicineName).join(' + ')}
            </button>
          )}
          {templates?.filter(t => !debouncedSearch || t.name.toLowerCase().includes(debouncedSearch.toLowerCase())).slice(0, debouncedSearch ? 20 : 5).map((t) => (
            <button key={t.id} type="button" className="rx-chip" onClick={() => applyTemplate(t)}>
              {t.name}
            </button>
          ))}
        </div>
      )}
      {skipNote && <p className="form-error" role="status">{skipNote}</p>}
      {combo.length > 0 && (
        <p className="rx-quick-add-note">
          Usual combo is based on drugs common across this patient's last 5 visits, not just the most recent one.
        </p>
      )}

      {debouncedSearch &&
        (searchResults && searchResults.length > 0 ? (
          <div className="search-results-anchor">
            <ul className="search-results">
              {searchResults.map((m) => (
                <li key={m.id}>
                  <button type="button" className="search-result-button" onClick={() => addFromSearch(m)}>
                    <span>{m.molecule_name || m.name}{m.molecule_name && m.molecule_name !== m.name ? ` · ${m.name}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rx-new-medicine">
            <p>No drug named "{debouncedSearch}" in the list.</p>
            <p className="field-hint">Reception will choose a matching stocked product and set its billing price.</p>
            <Button
              type="button"
              variant="secondary"
              disabled={addNewMedicine.isPending}
              onClick={() => addNewMedicine.mutate()}
            >
              {addNewMedicine.isPending ? 'Adding…' : `Add "${debouncedSearch}" as a new drug`}
            </Button>
            {addNewMedicine.isError && <p className="form-error">Couldn't add that drug — try again.</p>}
          </div>
        ))}

      {draftItems.length > 0 && (
        <div className="drug-row-list">
          {draftItems.map((item) => (
            <details key={item.key} className="drug-row" open={!closedRows.includes(item.key)} onToggle={event => {
              const open = event.currentTarget.open
              setClosedRows(previous => open === !previous.includes(item.key) ? previous : open ? previous.filter(key => key !== item.key) : [...previous, item.key])
            }}>
              <summary className="drug-row-head">
                <span className="drug-row-name">{item.medicineName} <span className="field-hint">{item.strength}</span></span>
                <span className="drug-row-summary">{item.dosageFrequency} · For {item.durationDays || '—'} days</span>
                <button type="button" className="drug-row-remove" onClick={e => { e.preventDefault(); removeDraft(item.key) }}>
                  Remove
                </button>
              </summary>
              <div className="drug-row-fields">
                <div className="field">
                  <label className="field-label">Type</label>
                  <Select value={item.drugType} onValueChange={(v) => updateDraft(item.key, { drugType: v })}>
                    <SelectTrigger aria-label={`Type for ${item.medicineName}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DRUG_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="field">
                  <label className="field-label">Strength</label>
                  <Input aria-label={`Strength for ${item.medicineName}`} value={item.strength} onChange={(e) => updateDraft(item.key, { strength: e.target.value })} placeholder="500mg" />
                </div>
                {item.drugType === 'Other' && <div className="field">
                  <label className="field-label">Supply unit</label>
                  <Input aria-label={`Supply unit for ${item.medicineName}`} value={item.stockUnit} maxLength={24} onChange={(e) => updateDraft(item.key, { stockUnit: e.target.value })} placeholder="e.g. ampoule" />
                </div>}
                <div className="field">
                  <label className="field-label">Food</label>
                  <div className="text-toggles" role="group" aria-label={`Food for ${item.medicineName}`}>{FOOD_OPTIONS.map(food => <button key={food} type="button" aria-pressed={item.beforeAfterFood === food} onClick={() => updateDraft(item.key, { beforeAfterFood: food })}>{food}</button>)}</div>
                </div>
                <div className="field">
                  <label className="field-label">Frequency</label>
                  <div className="text-toggles" role="group" aria-label={`Dose presets for ${item.medicineName}`}>{['1-0-0', '1-0-1', '1-1-1', 'SOS'].map(dose => <button key={dose} type="button" aria-pressed={item.dosageFrequency === dose} onClick={() => updateDraft(item.key, { dosageFrequency: dose })}>{dose}</button>)}</div>
                  <Input aria-label={`Frequency for ${item.medicineName}`} list="rx-frequencies" value={item.dosageFrequency} maxLength={200} onChange={e => updateDraft(item.key, { dosageFrequency: e.target.value })} placeholder="1-0-1, SOS, or type instructions" />
                </div>
                <div className="field">
                  <label className="field-label">Duration (days)</label>
                  <div className="text-toggles" role="group" aria-label={`Duration presets for ${item.medicineName}`}>{['3', '5', '7', '14', '30'].map(days => <button key={days} type="button" aria-pressed={item.durationDays === days} onClick={() => updateDraft(item.key, { durationDays: days })}>{days}</button>)}</div>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    aria-label={`Duration for ${item.medicineName}`}
                    value={item.durationDays}
                    onChange={(e) => updateDraft(item.key, { durationDays: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="field-label">Quantity prescribed ({medicineUnits?.find((m) => m.id === item.medicineId)?.stock_unit ?? (item.drugType === 'Other' ? item.stockUnit || 'unit' : prescribedUnit(item.drugType))})</label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    aria-label={`Quantity for ${item.medicineName}`}
                    value={item.quantityDispensed}
                    onChange={(e) => updateDraft(item.key, { quantityDispensed: e.target.value })}
                  />
                  {suggestedQuantity(item, medicineUnits?.find(m => m.id === item.medicineId)?.stock_unit ?? prescribedUnit(item.drugType)) != null && <Button type="button" variant="ghost" size="sm" onClick={() => updateDraft(item.key, { quantityDispensed: String(suggestedQuantity(item, medicineUnits?.find(m => m.id === item.medicineId)?.stock_unit ?? prescribedUnit(item.drugType))) })}>Use suggested {suggestedQuantity(item, medicineUnits?.find(m => m.id === item.medicineId)?.stock_unit ?? prescribedUnit(item.drugType))}</Button>}
                </div>
                <div className="field drug-row-notes">
                  <label className="field-label">Note</label>
                  <Input aria-label={`Note for ${item.medicineName}`} value={item.notes} onChange={(e) => updateDraft(item.key, { notes: e.target.value })} placeholder="Optional" />
                </div>
              </div>
              {!itemIsValid(item) && (
                <span className="field-error">Type, strength, food, frequency, duration and whole-number prescribed quantity are required.</span>
              )}
            </details>
          ))}
        </div>
      )}

      <datalist id="rx-frequencies">{FREQUENCY_OPTIONS.map(value => <option key={value} value={value} />)}</datalist>
      <label className="field rx-advice"><span className="field-label">Advice / investigations · English or Tamil</span><textarea value={advice} onChange={e => setAdvice(e.target.value)} maxLength={10000} rows={2} placeholder="Type advice in English or Tamil" /></label>
      <label className="field rx-diagnosis"><span className="field-label">Diagnosis · English or Tamil</span><textarea value={diagnosis} onChange={e => setDiagnosis(e.target.value)} maxLength={10000} rows={2} placeholder="Working or final diagnosis" /></label>
      {!diagnosis.trim() && <p className="rx-reminder" role="status">Diagnosis is missing. You can still issue this prescription.</p>}
      {draftItems.length > 0 && (
        <div className="action-row rx-actions">
          <Button type="button" disabled={!canReview} onClick={() => setReviewOpen(true)}>
            Review prescription
          </Button>
          <Button type="button" variant="secondary" disabled={!canReview} onClick={() => setShowSaveTemplate((s) => !s)}>
            Save as template
          </Button>
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
            <Input
              id="template-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. Standard analgesic set"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={saveTemplate.isPending || !templateName.trim()}>
            {saveTemplate.isPending ? 'Saving…' : 'Save'}
          </Button>
        </form>
      )}
      {saveTemplate.isError && <p className="form-error">Couldn't save the template — try again.</p>}
      {children}
    </div>{preview}</div>
  )
}
