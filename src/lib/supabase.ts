import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url) {
  throw new Error('Missing VITE_SUPABASE_URL — set it in .env.local')
}
if (!anonKey) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY — set it in .env.local')
}

export const supabase = createClient(url, anonKey)
