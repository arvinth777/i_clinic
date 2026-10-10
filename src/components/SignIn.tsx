import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Button } from './ui/button'
import { Input } from './ui/input'
import '../pages/Reception.css'

export function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (error) setError(error.message)
  }

  return (
    <div className="signin-screen">
      <aside className="signin-welcome">
        <strong>Clinic workspace</strong>
        <div><p>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p><h1>Ready for today.</h1><p>Reception, consultations and care — together.</p></div>
        <p>Salem Pain &amp; Palliative Care</p>
      </aside>
      <form className="signin" onSubmit={handleSubmit}>
      <h2 className="signin-heading">Sign in to your workspace</h2>
      <p className="signin-description">Use your clinic account to continue.</p>

      <div className="field">
        <label className="field-label" htmlFor="signin-email">
          Email
        </label>
        <Input
          id="signin-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="signin-password">
          Password
        </label>
        <Input
          id="signin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
    </div>
  )
}
