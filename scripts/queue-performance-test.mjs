import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as ReactQuery from '@tanstack/react-query'
const require = createRequire(import.meta.url)
const calls = []
let today = '2026-10-11T00:00:00Z'
const chain = new Proxy({}, { get: (_target, key) => key === 'then' ? (resolve => resolve({ data: [], error: null })) : (...args) => { calls.push([key, ...args]); return chain } })
const sdk = { from: table => { calls.push(['from', table]); return chain } }
function load(path) {
  const exports = {}
  const context = vm.createContext({ exports, setTimeout, clearTimeout, require: name => {
    if (name === '@tanstack/react-query') return ReactQuery
    if (name.endsWith('/supabase')) return { supabase: sdk }
    if (name.endsWith('/offlineQueue')) return {}
    if (name.endsWith('/date')) return { startOfToday: () => today, elapsedMinutes: () => 0, formatElapsed: () => 'now' }
    if (name.endsWith('/sort')) return { sortRows: rows => rows, nextSortState: () => null }
    if (name.endsWith('/pagedCache')) return load('src/lib/pagedCache.ts')
    if (name.endsWith('/realtimeStatus')) return load('src/lib/realtimeStatus.ts')
    if (name.endsWith('/stageLabels')) return load('src/lib/stageLabels.ts')
    if (name.endsWith('/queueActions')) return load('src/lib/queueActions.ts')
    if (name.endsWith('/confirm')) return { useAskReason: () => async () => null }
    if (name.endsWith('/QueryState')) return load('src/components/QueryState.tsx')
    if (name.endsWith('/ui/input')) return { Input: props => React.createElement('input', props) }
    if (name.endsWith('/ui/button')) return { Button: props => React.createElement('button', props) }
    if (name.endsWith('.css')) return {}
    return require(name)
  } })
  vm.runInContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context)
  return exports
}
const { queuePollInterval, batchRealtimeEvents } = load('src/lib/realtimeStatus.ts')
let refetches = 0
const burst = batchRealtimeEvents(() => refetches++)
for (let i = 0; i < 1005; i++) burst.notify()
await new Promise(resolve => setTimeout(resolve, 130))
assert.equal(refetches, 1, 'a burst triggers one authoritative refetch')
burst.notify(); burst.close()
await new Promise(resolve => setTimeout(resolve, 130))
assert.equal(refetches, 1, 'unmounted subscriptions cancel pending refetches')
assert.equal(queuePollInterval(true), 30_000)
assert.equal(queuePollInterval(false), 3_000, 'socket failure retains the quick fallback')
const { updateQueueRows } = load('src/lib/queueActions.ts')
const original = [{ id: 'a', stage: 'waiting', queue_position: 1024, arrived_at: '2026-10-11T01:00:00Z' }, { id: 'b', stage: 'waiting', queue_position: 2048, arrived_at: '2026-10-11T02:00:00Z' }]
assert.equal(updateQueueRows(original, 'b', 'move_up', 'now')[0].id, 'b')
assert.equal(original[0].queue_position, 1024, 'optimistic moves do not mutate the saved input')
for (const [action, stage] of [['call', 'called'], ['sent_in', 'with_doctor'], ['not_here', 'not_here'], ['no_show', 'no_show'], ['finish', 'ready_to_bill']]) {
  assert.equal(updateQueueRows(original, 'a', action, 'now')[0].stage, stage)
}
const { TokenList } = load('src/components/TokenList.tsx')
const client = new ReactQuery.QueryClient({ defaultOptions: { queries: { retry: false } } })
const saved = Array.from({ length: 1005 }, (_, i) => ({ id: `old-${i}`, stage: 'ready_to_bill', arrived_at: '2026-10-10T00:00:00Z', queue_position: i, patients: { name: `Older ${i}` } }))
client.setQueryData(['visits-today', 'clinic'], [...saved, { id: 'today', stage: 'waiting', arrived_at: '2026-10-11T01:00:00Z', patients: { name: 'Today only' } }, { id: 'old-no-show', stage: 'no_show', arrived_at: '2026-10-10T00:00:00Z' }])
const html = renderToStaticMarkup(React.createElement(ReactQuery.QueryClientProvider, { client }, React.createElement(TokenList, { clinicId: 'clinic' })))
assert.match(html, /Today only/)
assert.doesNotMatch(html, /Older 0/)
const earlier = client.getQueryCache().find({ queryKey: ['visits-earlier', 'clinic'], exact: false })
assert.equal(earlier.state.data.pages.flat().length, 1005, 'upgrade preserves every saved older open visit in paged offline data')
assert.equal(earlier.state.data.pages[0].length, 50)
assert.equal(earlier.state.data.pages.at(-1).length, 5)
await earlier.options.queryFn({ pageParam: 50 })
assert.ok(calls.some(call => call[0] === 'range' && call[1] === 50 && call[2] === 99), 'older records fetch only the next 50')
assert.ok(calls.some(call => call[0] === 'lt' && call[1] === 'arrived_at'))
calls.length = 0
await client.getQueryCache().find({ queryKey: ['visits-today', 'clinic'], exact: true }).options.queryFn()
assert.ok(calls.some(call => call[0] === 'gte' && call[1] === 'arrived_at'), 'today read cannot grow with settled history')
assert.ok(!calls.some(call => call[0] === 'or'), 'today no longer includes all historical non-paid rows')
// A new day must recover older pages even after yesterday's flat queue was refetched.
client.setQueryData(['visits-today', 'clinic'], [{ id: 'yesterday', stage: 'waiting', arrived_at: '2026-10-11T01:00:00Z', patients: { name: 'Yesterday' } }])
today = '2026-10-12T00:00:00Z'
renderToStaticMarkup(React.createElement(ReactQuery.QueryClientProvider, { client }, React.createElement(TokenList, { clinicId: 'clinic' })))
const restored = client.getQueryData(['visits-earlier', 'clinic', today, 'pages'])
assert.equal(restored.pages.flat().length, 1006, 'offline midnight reload merges prior pages with yesterday without losing history beyond the API cap')
assert.ok(restored.pages.flat().some(row => row.id === 'old-1004'))
client.clear()
const sw = readFileSync('dist/sw.js', 'utf8')
for (const file of readdirSync('dist/assets').filter(file => /\.(js|css|woff2)$/.test(file))) assert.ok(sw.includes(`assets/${file}`), `${file} must be precached for lazy offline navigation and printing`)
assert.ok(!sw.includes('letterhead-a4.png'))
console.log('PASS: polling fallback, optimistic stages/moves, legacy offline history, server pagination and every lazy/print asset precached')
