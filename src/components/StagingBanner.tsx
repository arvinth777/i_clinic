import './StagingBanner.css'

const PRODUCTION_SUPABASE_URL = 'https://rmuhpgpvgvwchovlgxae.supabase.co'

// A preview build is still a production build pointed at staging, so build
// mode (NODE_ENV / import.meta.env.DEV) says nothing about which database is
// behind it — the only reliable signal is which Supabase project is live.
export function StagingBanner() {
  const isStaging = import.meta.env.VITE_SUPABASE_URL !== PRODUCTION_SUPABASE_URL

  if (!isStaging) return null

  return (
    <div className="staging-banner">
      Staging · synthetic patients only
    </div>
  )
}
