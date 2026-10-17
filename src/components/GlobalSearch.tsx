import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { AlertTarget } from '../lib/clinicAlerts'
import type { ShellSection } from './AppShell'

// Words people use for each place. Searching any of them lists the place; only places this login can open are offered.
const KEYWORDS: Record<string, string> = {
  reception: 'queue check in register new patient token waiting pharma rep follow-up',
  consultation: 'consultation doctor prescription call next patient',
  billing: 'billing payment bill receipt collect cash upi',
  pharmacy: 'medicine sale refill sell medicine',
  unpaid: 'unpaid bills credit pay later settle owed',
  patients: 'patients records history timeline notes documents',
  register: 'long-term care long term review due regular',
  merge: 'duplicate duplicates merge same patient twice',
  stock: 'stock inventory medicines purchase supplier suppliers expiry low stock count transfer',
  reports: 'reports collections gst tax monthly daily export csv',
  reconciliation: 'needs review reconciliation correction',
  admin: 'settings prices procedures templates staff logins clinic information custom fields upi fee',
}
type Hit = { id: string; kind: 'Go to' | 'Patient' | 'Medicine' | 'Do'; label: string; hint?: string; run: () => void }

export function GlobalSearch({ clinicId, sections, onGo, onOpen, actions }: {
  clinicId: string | null | undefined
  sections: ShellSection[]
  onGo: (key: string) => void
  onOpen: (target: AlertTarget) => void
  actions: { label: string; words: string; run: () => void }[]
}) {
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { const t = setTimeout(() => setDebounced(text.trim()), 250); return () => clearTimeout(t) }, [text])
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const slash = (event: KeyboardEvent) => { if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement).tagName) && !(event.target as HTMLElement).isContentEditable) { event.preventDefault(); input.current?.focus() } }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', slash)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', slash) }
  }, [])

  const enabled = !!clinicId && debounced.length >= 2
  const { data: patients } = useQuery({
    queryKey: ['global-search-patients', clinicId, debounced], enabled,
    queryFn: async () => { const { data, error } = await supabase.rpc('search_patients', { p_clinic_id: clinicId, p_query: debounced }); if (error) throw error; return (data as { id: string; name: string; age: number | null; phone: string | null }[]).slice(0, 5) },
  })
  const { data: medicines } = useQuery({
    queryKey: ['global-search-medicines', clinicId, debounced], enabled,
    queryFn: async () => { const { data, error } = await supabase.from('medicines').select('id, name').eq('clinic_id', clinicId!).eq('is_active', true).ilike('name', `%${debounced.replace(/[%_,()]/g, ' ')}%`).limit(5); if (error) throw error; return data },
  })

  const q = text.trim().toLowerCase()
  const hits: Hit[] = []
  if (q.length >= 2) {
    for (const section of sections) {
      const words = `${section.label} ${section.tab ?? ''} ${KEYWORDS[section.key] ?? ''}`.toLowerCase()
      if (q.split(/\s+/).every(part => words.includes(part))) hits.push({ id: `go:${section.key}`, kind: 'Go to', label: section.tab && !section.group ? `${section.label} · ${section.tab}` : section.label, run: () => onGo(section.key) })
    }
    for (const action of actions) if (q.split(/\s+/).every(part => `${action.label} ${action.words}`.toLowerCase().includes(part))) hits.push({ id: `do:${action.label}`, kind: 'Do', label: action.label, run: action.run })
    for (const p of patients ?? []) hits.push({ id: `p:${p.id}`, kind: 'Patient', label: p.name, hint: [p.age ? `${p.age}y` : '', p.phone ?? ''].filter(Boolean).join(' · '), run: () => onOpen({ section: 'patients', patientId: p.id }) })
    if (sections.some(s => s.key === 'stock')) for (const m of medicines ?? []) hits.push({ id: `m:${m.id}`, kind: 'Medicine', label: m.name, run: () => onOpen({ section: 'stock', medicineId: m.id }) })
  }
  const choose = (hit: Hit) => { hit.run(); setText(''); setOpen(false); input.current?.blur() }
  return (
    <div className="shell-search" ref={box} role="search">
      <input ref={input} className="shell-search-input" type="search" aria-label="Search patients, medicines and pages" placeholder="Search…  ( / )" value={text} autoComplete="off"
        onChange={event => { setText(event.target.value); setOpen(true); setActive(0) }} onFocus={() => setOpen(true)}
        onKeyDown={event => {
          if (event.key === 'Escape') { setOpen(false); input.current?.blur() }
          else if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => Math.min(i + 1, hits.length - 1)) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
          else if (event.key === 'Enter' && hits[active]) { event.preventDefault(); choose(hits[active]) }
        }} />
      {open && q.length >= 2 && (
        <ul className="shell-search-results" role="listbox">
          {hits.map((hit, i) => <li key={hit.id} role="option" aria-selected={i === active}><button type="button" className="shell-search-hit" data-active={i === active || undefined} onMouseEnter={() => setActive(i)} onClick={() => choose(hit)}><span className="shell-search-kind">{hit.kind}</span><span>{hit.label}{hit.hint && <small> {hit.hint}</small>}</span></button></li>)}
          {hits.length === 0 && <li className="shell-search-empty">{enabled && (patients === undefined || medicines === undefined) ? 'Searching…' : 'Nothing found. Try a patient name, phone number, medicine or page name.'}</li>}
        </ul>
      )}
    </div>
  )
}
