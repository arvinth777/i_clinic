// "✓ Saved" after a save that leaves the form on screen. It fades on its own (CSS), so no timer or state is needed.
export function SaveTick({ mutation }: { mutation: { isSuccess: boolean; submittedAt: number } }) {
  return mutation.isSuccess ? <span key={mutation.submittedAt} className="save-state save-state-ok save-fade" role="status">✓ Saved</span> : null
}
