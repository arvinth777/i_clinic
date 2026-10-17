import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { attemptOrQueue } from '../../lib/offlineQueue'
import { LoadingRows, QueryError } from '../QueryState'

// Clinic-wide switch for the automatic idle lock. The Lock button always works.
export function IdleLockSetting({ clinicId }: { clinicId: string }) {
  const client = useQueryClient(), key = ['idle-lock', clinicId]
  const query = useQuery({ queryKey: key, queryFn: async () => {
    const { data, error } = await supabase.from('clinics').select('idle_lock_enabled').eq('id', clinicId).single()
    if (error) throw error
    return data.idle_lock_enabled as boolean
  } })
  const save = useMutation({ networkMode: 'always', mutationFn: async (enabled: boolean) => {
    const args = { p_clinic_id: clinicId, p_enabled: enabled }
    await attemptOrQueue({ clinicId, attempt: token => supabase.rpc('set_idle_lock', args).setHeader('Authorization', `Bearer ${token}`), queueItem: () => ({ kind: 'rpc', rpc: 'set_idle_lock', payload: args, description: enabled ? 'Turn the automatic screen lock on' : 'Turn the automatic screen lock off' }), applyOptimistic: () => client.setQueryData(key, enabled) })
  }, onSuccess: () => void client.invalidateQueries({ queryKey: key }) })
  return <section style={{ marginTop: 'var(--space-xl)' }}><h2>Screen lock</h2>
    {query.isError && <QueryError retry={() => void query.refetch()} savedAt={query.dataUpdatedAt} />}
    {query.isPending ? <LoadingRows label="Loading settings…" /> : query.data !== undefined && <div className="field">
      <label className="field-label" htmlFor="idle-lock-enabled"><input id="idle-lock-enabled" type="checkbox" checked={query.data} disabled={save.isPending} onChange={event => save.mutate(event.target.checked)} /> Lock the screen automatically when nobody is using it</label>
      <p className="field-hint">{query.data ? 'Reception and other logins lock after 2 minutes, doctors after 15 minutes.' : 'Automatic locking is off on every computer: patient names stay on screen until someone presses Lock.'} The Lock button in the top bar always works.</p>
    </div>}
    {save.isError && <p role="alert" className="form-error">{save.error.message}</p>}
  </section>
}
