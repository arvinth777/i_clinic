import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Drawer } from '../Drawer'

type Login = { user_id: string; email: string; role: string }

const ROLES = ['doctor', 'receptionist', 'admin'] as const

// list_clinic_logins/admin-create-login exist because a plain client query
// can't join auth.users (outside the public schema) and can't create one
// (needs the service role) -- see the migration/Edge Function for why.
// Removing a role is a plain authenticated delete: user_roles' own RLS
// already lets admin do that directly, no elevated path needed. This
// revokes access for this clinic; it does not delete the underlying login,
// which may hold a role at another clinic once a second one exists.
export function LoginsPanel({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['admin-logins', clinicId]
  const { data: logins } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_clinic_logins', { p_clinic_id: clinicId })
      if (error) throw error
      return data as Login[]
    },
  })

  const [adding, setAdding] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<(typeof ROLES)[number]>('receptionist')
  const [formError, setFormError] = useState('')

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-create-login', {
        body: { email: email.trim(), password, role, clinic_id: clinicId },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setAdding(false)
      setEmail('')
      setPassword('')
    },
    onError: (e: Error) => setFormError(e.message),
  })

  const removeRole = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from('user_roles').delete().eq('user_id', userId).eq('clinic_id', clinicId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  return (
    <div>
      <div className="admin-toolbar">
        <h2 className="readout-heading">Logins</h2>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setEmail('')
            setPassword('')
            setRole('receptionist')
            setFormError('')
            setAdding(true)
          }}
        >
          + Add login
        </button>
      </div>
      <div className="worklist-scroll">
        <table className="worklist">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(logins ?? []).map((l) => (
              <tr key={`${l.user_id}-${l.role}`} className="worklist-row">
                <td className="worklist-name-cell">{l.email}</td>
                <td>{l.role}</td>
                <td>
                  <button
                    type="button"
                    className="drug-row-remove"
                    onClick={() => {
                      if (confirm(`Remove ${l.email}'s ${l.role} access to this clinic?`)) removeRole.mutate(l.user_id)
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer open={adding} onClose={() => setAdding(false)} title="Add login">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor="login-email">
              Email
            </label>
            <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="login-password">
              Password
            </label>
            <input id="login-password" type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="login-role">
              Role
            </label>
            <select id="login-role" value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          {formError && <p className="form-error">{formError}</p>}
          <div className="action-row">
            <button type="submit" className="primary-button" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create login'}
            </button>
            <button type="button" className="secondary-button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Drawer>
    </div>
  )
}
