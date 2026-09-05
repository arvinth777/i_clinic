import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

// Auth token refresh failing while offline must not silently look like a
// logged-out state (AGENTS.md non-negotiable, offline decision #4) --
// tracked here as a distinct `loading` phase so the UI can tell "we don't
// know yet" apart from "signed out", instead of collapsing both to null.
export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  return { session, loading }
}
