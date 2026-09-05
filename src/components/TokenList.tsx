import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from '../lib/supabase'

const rowTransition = { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const }

type Visit = {
  id: string
  token_number: number
  stage: string
  patients: { name: string } | null
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

// Colour alone is never the signal -- shape carries it too, so the stage
// survives any colour-vision deficiency; the word is shown as well since
// nothing here requires glance-only scanning. Matches the `stage` check
// constraint in the visits table.
const STAGES: Record<string, { label: string; color: string }> = {
  waiting: { label: 'Waiting', color: 'var(--stage-waiting)' },
  with_doctor: { label: 'With doctor', color: 'var(--stage-with-doctor)' },
  packing: { label: 'Packing', color: 'var(--stage-packing)' },
  ready_at_reception: { label: 'Ready at reception', color: 'var(--stage-ready)' },
  paid: { label: 'Paid', color: 'var(--stage-paid)' },
}

function StageGlyph({ stage }: { stage: string }) {
  const meta = STAGES[stage] ?? { label: stage, color: 'var(--text-tertiary)' }
  return (
    <span className="stage-pill">
      <StageShape stage={stage} color={meta.color} />
      {meta.label}
    </span>
  )
}

function StageShape({ stage, color }: { stage: string; color: string }) {
  const box = { width: 20, height: 20, viewBox: '0 0 20 20', 'aria-hidden': true as const }
  switch (stage) {
    case 'waiting':
      return (
        <svg {...box}>
          <circle cx="10" cy="10" r="7" fill="none" stroke={color} strokeWidth="2.5" />
        </svg>
      )
    case 'with_doctor':
      return (
        <svg {...box}>
          <circle cx="10" cy="10" r="7" fill={color} />
        </svg>
      )
    case 'packing':
      return (
        <svg {...box}>
          <rect x="4" y="4" width="12" height="12" fill={color} transform="rotate(45 10 10)" />
        </svg>
      )
    case 'ready_at_reception':
      return (
        <svg {...box}>
          <polygon points="10,3 17,16 3,16" fill={color} />
        </svg>
      )
    case 'paid':
      return (
        <svg {...box}>
          <circle cx="10" cy="10" r="7" fill={color} />
          <path
            d="M6.5 10.2l2.3 2.3 4.7-4.9"
            fill="none"
            stroke="var(--surface)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    default:
      return (
        <svg {...box}>
          <circle cx="10" cy="10" r="7" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray="3 3" />
        </svg>
      )
  }
}

export function TokenList({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['visits-today', clinicId]

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('id, token_number, stage, patients(name)')
        .eq('clinic_id', clinicId)
        .gte('arrived_at', startOfToday())
        .order('arrived_at', { ascending: true })
      if (error) throw error
      return data as unknown as Visit[]
    },
  })

  // An event invalidates the query and triggers a refetch -- it never
  // patches state from the payload (AGENTS.md non-negotiable #6 / Technical
  // Decision #3). Sockets drop on sleep/wifi flap; refetchInterval on the
  // query client is what self-heals a missed event.
  useEffect(() => {
    const channel = supabase
      .channel(`visits-today-${clinicId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visits', filter: `clinic_id=eq.${clinicId}` },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId])

  if (isLoading) return null
  if (!data || data.length === 0) return <p className="readout-empty">No patients yet today.</p>

  return (
    <div className="readout-list">
      <AnimatePresence initial={false}>
        {data.map((v) => (
          <motion.div
            key={v.id}
            className="readout-row"
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={rowTransition}
          >
            <span className="readout-token">{v.token_number}</span>
            <span className="readout-name">{v.patients?.name}</span>
            <StageGlyph stage={v.stage} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
