export const STAGES: Record<string, { label: string; color: string }> = {
  waiting: { label: 'Waiting', color: 'var(--stage-waiting)' },
  with_doctor: { label: 'With doctor', color: 'var(--stage-with-doctor)' },
  called: { label: 'Called · waiting for reception', color: 'var(--blue)' },
  ready_to_bill: { label: 'Ready to bill', color: 'var(--amber)' },
  not_here: { label: 'Not here', color: 'var(--muted)' },
  no_show: { label: 'No-show', color: 'var(--muted)' },
  paid: { label: 'Paid', color: 'var(--stage-paid)' },
}

// Display text for a stored stage; stored values stay raw.
export const stageLabel = (stage: string) => STAGES[stage]?.label ?? stage
