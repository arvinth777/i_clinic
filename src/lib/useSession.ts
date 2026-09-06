import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { queryClient } from './queryClient'
import { persister } from './persistQuery'

// Auth token refresh failing while offline must not silently look like a
// logged-out state (AGENTS.md non-negotiable, offline decision #4). This
// hook does not implement that guarantee itself -- it comes from
// @supabase/auth-js (pinned via @supabase/supabase-js@2.109.0)
// GoTrueClient#_callRefreshToken: a network failure is classified
// AuthRetryableFetchError and never reaches `_removeSession()` (which is
// what fires SIGNED_OUT), and even a genuine rejection only tears down the
// session once the access token has actually expired, not on every
// proactive refresh attempt. A caret-ranged bump of @supabase/supabase-js
// could in principle change this; there is no test in this repo that pins
// the behaviour itself, only this comment as the breadcrumb. What this
// hook does add: clearing the persisted query cache and mutation-adjacent
// read cache on a genuine SIGNED_OUT, since Phase F put patient names,
// complaints, and prescriptions into IndexedDB on what may be a shared
// reception machine, and that must not outlive the session that wrote it.
export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (event === 'SIGNED_OUT') {
        queryClient.clear()
        void persister.removeClient()
      }
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  return { session, loading }
}
