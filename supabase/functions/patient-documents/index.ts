import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createHandler } from './handler.ts'
Deno.serve(createHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL')!,
  anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  appUrl: Deno.env.get('CLINIC_APP_URL')!,
  clientId: Deno.env.get('GOOGLE_DRIVE_CLIENT_ID'),
  clientSecret: Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET'),
  encryptionKey: Deno.env.get('GOOGLE_DRIVE_ENCRYPTION_KEY'),
}))
