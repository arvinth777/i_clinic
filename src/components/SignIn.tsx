import { useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { supabase } from '../lib/supabase'
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
    <form className="signin" onSubmit={handleSubmit}>
      <h1 className="signin-heading">Sign in</h1>

      <div className="field">
        <label className="field-label" htmlFor="signin-email">
          Email
        </label>
        <input
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
        <input
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

      <motion.button type="submit" className="primary-button" whileTap={{ scale: 0.97 }} disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </motion.button>
    </form>
  )
}
