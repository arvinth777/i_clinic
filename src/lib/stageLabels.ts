export const STAGES: Record<string, { label: string; color: string; tone: 'info' | 'live' | 'warn' | 'ok' | 'bad' | 'mute' }> = {
  waiting: { label: 'Waiting', color: 'var(--stage-waiting)', tone: 'info' },
  with_doctor: { label: 'With doctor', color: 'var(--stage-with-doctor)', tone: 'live' },
  called: { label: 'Called · waiting for reception', color: 'var(--blue)', tone: 'live' },
  ready_to_bill: { label: 'Ready to bill', color: 'var(--amber)', tone: 'warn' },
  not_here: { label: 'Not here', color: 'var(--muted)', tone: 'warn' },
  no_show: { label: 'No-show', color: 'var(--muted)', tone: 'mute' },
  cancelled: { label: 'Cancelled', color: 'var(--muted)', tone: 'mute' },
  paid: { label: 'Paid', color: 'var(--stage-paid)', tone: 'ok' },
}

// Display text for a stored stage; stored values stay raw.
export const stageLabel = (stage: string) => STAGES[stage]?.label ?? stage
