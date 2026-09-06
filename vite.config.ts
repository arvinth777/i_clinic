import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // autoUpdate, not the default 'prompt' -- a receptionist mid-shift
      // has no use for an update-available toast; the new service worker
      // takes over on the next navigation via clientsClaim/skipWaiting,
      // never mid-session.
      registerType: 'autoUpdate',
      // Precache the app shell (requirement 1): a reload with the network
      // cut must still boot the app, not show the browser's own offline
      // page. Default globPatterns omit font files -- @fontsource ships
      // them as hashed .woff2 in the build, and requirement 5 (print with
      // zero connectivity) depends on the prescription/receipt rendering
      // in the same faces every other screen uses, not a browser fallback
      // font substituted mid-print.
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,woff,svg,ico,png}'],
        // No runtimeCaching entries for Supabase's origin, deliberately --
        // a stale cached API response is worse than the request simply
        // failing (offlineQueue.ts is what actually handles that failure).
        // Nothing here caches anything beyond this app's own build output.
      },
      manifest: {
        name: 'i Clinic',
        short_name: 'i Clinic',
        start_url: '/',
        display: 'standalone',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    }),
  ],
})
