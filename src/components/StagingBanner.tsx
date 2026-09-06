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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path d="M12 3 L22 20 L2 20 Z" strokeLinejoin="round" />
        <line x1="12" y1="9" x2="12" y2="14" strokeLinecap="round" />
        <circle cx="12" cy="17" r="0.5" fill="currentColor" />
      </svg>
      STAGING — not real patients
    </div>
  )
}
