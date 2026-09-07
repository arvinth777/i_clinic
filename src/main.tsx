import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { setupPersistedQueryClient } from './lib/persistQuery'
import * as offlineQueue from './lib/offlineQueue'

setupPersistedQueryClient()
// Dev-only: scripts/patient-info-redaction-test.mjs uses this to force a
// genuinely halted mutation deterministically (a real rejection, not a
// staged network failure) rather than racing a real offline scenario.
// import.meta.env.DEV is a build-time constant -- Vite dead-code-eliminates
// this whole block from a production build (`vite build`), so it never
// ships; `npm run dev` is what that test already requires regardless.
if (import.meta.env.DEV) {
  ;(window as unknown as { __debugQueue: typeof offlineQueue }).__debugQueue = offlineQueue
}
// Self-hosted (not a Google Fonts CDN link) so the clinic's screens keep
// rendering with the intended faces even with zero connectivity (see
// PRODUCT.md's offline requirement).
//
// v4.5 font pass: researched directly (not guessed) what "premium tech"
// typography actually means in 2026 -- Geist (Vercel's own sans, paired
// with Geist Mono) is the fast-rising default for developer-tool brand
// work, and the pairing named as "the gold standard for developer
// tools" is Geist for headings with Inter kept for body-text legibility.
// Inter stays on body copy for exactly that reason; Geist Sans takes
// over headings/section-labels (--font-display) and Geist Mono replaces
// JetBrains Mono for numerals, so the two Vercel-designed faces form one
// coherent pair rather than a third, unrelated mono typeface.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-sans/700.css'
import '@fontsource/geist-sans/800.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource/geist-mono/700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
