import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

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

  if (adding) {
    return (
      <div>
        <button type="button" className="back-to-queue" onClick={() => setAdding(false)}>
          ← Back to logins
        </button>
        <h2 className="readout-heading">Add login</h2>
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
            <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="login-password">
              Password
            </label>
            <Input id="login-password" type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="login-role">
              Role
            </label>
            <Select value={role} onValueChange={(v) => setRole(v as (typeof ROLES)[number])}>
              <SelectTrigger id="login-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {formError && <p className="form-error">{formError}</p>}
          <div className="action-row">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create login'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div>
      <div className="admin-toolbar">
        <h2 className="readout-heading">Logins</h2>
        <Button
          type="button"
          onClick={() => {
            setEmail('')
            setPassword('')
            setRole('receptionist')
            setFormError('')
            setAdding(true)
          }}
        >
          + Add login
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(logins ?? []).map((l) => (
            <TableRow key={`${l.user_id}-${l.role}`}>
              <TableCell className="worklist-name-cell">{l.email}</TableCell>
              <TableCell>{l.role}</TableCell>
              <TableCell>
                <button
                  type="button"
                  className="drug-row-remove"
                  onClick={() => {
                    if (confirm(`Remove ${l.email}'s ${l.role} access to this clinic?`)) removeRole.mutate(l.user_id)
                  }}
                >
                  Remove
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
