const PRODUCTION_SUPABASE_URL = 'https://rmuhpgpvgvwchovlgxae.supabase.co'

// A preview build is still a production build pointed at staging, so build
// mode (NODE_ENV / import.meta.env.DEV) says nothing about which database is
// behind it — the only reliable signal is which Supabase project is live.
export function StagingBanner() {
  const isStaging = import.meta.env.VITE_SUPABASE_URL !== PRODUCTION_SUPABASE_URL

  if (!isStaging) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2147483647,
        background: '#ff0000',
        color: '#ffffff',
        fontWeight: 700,
        textAlign: 'center',
        padding: '6px 0',
        letterSpacing: '0.05em',
      }}
    >
      STAGING — not real patients
    </div>
  )
}
