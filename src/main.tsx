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
// Self-hosted fonts remain available offline.
import '@fontsource/hanken-grotesk/latin-400.css'
import '@fontsource/hanken-grotesk/latin-500.css'
import '@fontsource/hanken-grotesk/latin-600.css'
import '@fontsource/hanken-grotesk/latin-700.css'
import './index.css'
import App from './App.tsx'
import { DriveCallback } from './components/DriveCallback'

const isDriveCallback = new URLSearchParams(window.location.search).has('drive_callback')
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <>{isDriveCallback ? <DriveCallback /> : <App />}</>
    </QueryClientProvider>
  </StrictMode>,
)
