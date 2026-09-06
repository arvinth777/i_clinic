import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { setupPersistedQueryClient } from './lib/persistQuery'

setupPersistedQueryClient()
// Self-hosted (not a Google Fonts CDN link) so the clinic's screens keep
// rendering with the intended faces even with zero connectivity (see
// PRODUCT.md's offline requirement). One workhorse family (Inter) now
// carries headings, body, and UI -- v4 drops Space Grotesk as a second
// display face; the paper identity comes from tokens, not a second font.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
