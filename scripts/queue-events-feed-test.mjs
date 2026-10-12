// The header's event feed (banner + reception call chime) must be a valid query against the real schema.
// Reads the select string out of AppShell.tsx and runs it on staging as reception. Optional arg: another AppShell file.
// Run from the project root: node scripts/queue-events-feed-test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
const env = p => Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const a=env('.env.local'),pw=env('.env.test-users.local')
assert.equal(new URL(a.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co')
const source=readFileSync(process.argv[2]??'src/components/AppShell.tsx','utf8')
const select=source.match(/from\('queue_events'\)\.select\('([^']+)'\)/)?.[1]
assert.ok(select,'queue_events select not found in AppShell')
const c=createClient(a.VITE_SUPABASE_URL,a.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:ws}})
assert.ifError((await c.auth.signInWithPassword({email:'reception.a@staging.test',password:pw.TEST_RECEPTION_A_PASSWORD})).error)
const { data, error } = await c.from('queue_events').select(select).limit(1)
assert.ifError(error)
assert.ok(data[0] && 'id' in data[0], 'events must expose an id for chime de-duplication')
console.log(`PASS: header event feed query is valid (${select})`)
process.exit(0)
