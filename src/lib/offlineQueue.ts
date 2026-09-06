import { createStore, set, del, entries } from 'idb-keyval'
import { supabase } from './supabase'

// Durable mutation queue (AGENTS.md non-negotiable #8): IndexedDB, not
// localStorage -- survives a refresh and a browser crash. A dedicated
// idb-keyval store, separate from the React Query persister's own store
// (src/lib/persistQuery.ts) -- that one has a maxAge and is evictable; this
// one must never expire or be swept just because cached reads were.
const store = createStore('offline-queue-db', 'mutations')

export type QueuedMutation = {
  id: string // client-generated uuid -- for an insert, this IS the row's own PK, which is what makes replay idempotent (upsert-on-conflict, not a separate key column)
  seq: number // monotonic within this tab's lifetime; createdAt alone can collide at ms resolution for two mutations enqueued in the same synchronous block (e.g. a prescription row then its items)
  kind: 'insert' | 'update' | 'delete' | 'rpc'
  table?: string // insert/update/delete
  match?: Record<string, string> // update/delete: eq() column/value pairs, applied in order
  rpc?: string // rpc
  payload?: unknown // insert: a row or array of rows. update: the patch object. rpc: the params object. delete: unused.
  description: string // shown in the "not saved yet" UI
  createdAt: string
}

let seqCounter = Date.now()
function nextSeq() {
  return (seqCounter += 1)
}

type Listener = () => void
const listeners = new Set<Listener>()
export function subscribeQueue(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify() {
  for (const fn of listeners) fn()
}

export async function enqueue(mutation: Omit<QueuedMutation, 'id' | 'seq' | 'createdAt'> & { id?: string }): Promise<QueuedMutation> {
  const full: QueuedMutation = {
    id: mutation.id ?? crypto.randomUUID(),
    seq: nextSeq(),
    createdAt: new Date().toISOString(),
    ...mutation,
  }
  await set(full.id, full, store)
  notify()
  return full
}

export async function listQueue(): Promise<QueuedMutation[]> {
  const all = await entries<string, QueuedMutation>(store)
  return all.map(([, v]) => v).sort((a, b) => a.seq - b.seq)
}

async function dequeue(id: string) {
  await del(id, store)
  notify()
}

// A network failure (offline, DNS down, request never reached the server)
// surfaces from supabase-js/postgrest-js as a plain error with no Postgres
// SQLSTATE `code` and no HTTP-shaped `status` -- a real server rejection
// (constraint violation, RLS denial, an RPC's own `raise exception`) always
// carries one of those. This is the split requirement 3 needs: a network
// failure re-queues silently and waits for reconnect; a genuine rejection
// halts the drain and surfaces to a human, since replaying it again would
// just fail again the same way.
function isNetworkFailure(err: unknown): boolean {
  if (!navigator.onLine) return true
  const e = err as { code?: unknown; status?: unknown; message?: unknown } | null
  if (!e) return true
  if (typeof e.code === 'string' || typeof e.status === 'number') return false
  const msg = typeof e.message === 'string' ? e.message : ''
  return /fetch|network|Failed to fetch/i.test(msg) || msg === ''
}

async function replayOne(m: QueuedMutation): Promise<void> {
  if (m.kind === 'insert') {
    // ignoreDuplicates on the client-generated PK is what makes a replay of
    // an already-applied insert a no-op instead of a duplicate row -- the
    // id doubles as the idempotency key, no separate column needed.
    const { error } = await supabase.from(m.table!).upsert(m.payload as object, { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw error
  } else if (m.kind === 'update') {
    let q = supabase.from(m.table!).update(m.payload as object)
    for (const [k, v] of Object.entries(m.match ?? {})) q = q.eq(k, v)
    // RLS denial on an UPDATE returns { data: [], error: null } -- zero rows,
    // no error (docs/STATUS.md already flags this from phase-d-test.mjs). Left
    // unchecked, a write the caller isn't permitted to make would dequeue as
    // if it had succeeded, and requirement 6 (unmissable unsynced work) would
    // have nothing left to warn about. .select() is what makes the affected
    // rows visible so a permission denial (or the row being gone) can be
    // told apart from a real success and routed to the halt path instead.
    const { data, error } = await q.select()
    if (error) throw error
    if (!data || data.length === 0) throw new Error(`${m.table}: matched no rows (permission denied, or the row no longer exists)`)
  } else if (m.kind === 'delete') {
    // Deleting an already-deleted (or never-created) row matches zero rows
    // and returns no error -- naturally idempotent, no special handling.
    let q = supabase.from(m.table!).delete()
    for (const [k, v] of Object.entries(m.match ?? {})) q = q.eq(k, v)
    const { error } = await q
    if (error) throw error
  } else if (m.kind === 'rpc') {
    const { error } = await supabase.rpc(m.rpc!, m.payload as Record<string, unknown>)
    if (error) throw error
  }
}

export type HaltedMutation = { mutation: QueuedMutation; error: string }

let halted: HaltedMutation | null = null
let draining = false

export function getHalted(): HaltedMutation | null {
  return halted
}

// Serial, oldest-first, stop on the first genuine failure -- requirement 3.
// A visit_pricing revision replayed out of order breaks the monotonic
// revision_number; skipping ahead past a failed write would silently
// corrupt whatever depends on it landing first (a prescription_items row
// whose prescription_id points at a not-yet-replayed prescriptions row,
// for one). One drain runs at a time (the `draining` guard) -- the online
// listener and the manual retry button can both ask for a drain without
// racing each other.
export async function drainQueue(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (true) {
      const queue = await listQueue()
      notify()
      if (queue.length === 0) {
        halted = null
        return
      }
      const next = queue[0]
      try {
        await replayOne(next)
        await dequeue(next.id)
        halted = null
      } catch (err) {
        if (isNetworkFailure(err)) {
          // Still offline (or just went back offline mid-drain) -- stop
          // quietly, nothing is wrong, retry on the next reconnect event.
          return
        }
        halted = { mutation: next, error: err instanceof Error ? err.message : String(err) }
        notify()
        return
      }
    }
  } finally {
    draining = false
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void drainQueue())
  // Backstop for the case the 'online' event doesn't fire reliably (some
  // browsers/OSes), same philosophy as the app's existing Realtime backstop
  // poll -- cheap at this scale, not the primary mechanism.
  setInterval(() => {
    if (navigator.onLine) void drainQueue()
  }, 15_000)
}

// Attempts a write online-first; on a network failure (not a real
// rejection), enqueues it instead and applies the optimistic patch so the
// UI -- and, critically, print -- reflects it immediately regardless of
// connectivity. Returns whether it ended up queued.
export async function attemptOrQueue(args: {
  // PromiseLike, not Promise: a raw (unawaited) supabase-js query builder is
  // thenable but not structurally a full Promise (no .catch/.finally) --
  // this accepts it directly so call sites don't need an extra async
  // wrapper just to satisfy the type.
  attempt: () => PromiseLike<{ error: unknown }>
  queueItem: () => Omit<QueuedMutation, 'id' | 'seq' | 'createdAt'> & { id?: string }
  applyOptimistic?: () => void
}): Promise<{ queued: boolean }> {
  // Being online is not enough to attempt directly -- requirement 3 is
  // "never skip ahead". A halted mutation is never dequeued (it sits at the
  // front until a human resolves it), and drainQueue's own listQueue() call
  // races the 'online' listener's fire-and-forget drain against whatever the
  // user does next -- without this check, a fresh online-first write could
  // land before an older queued (or halted) one finishes replaying, which is
  // exactly the out-of-order corruption a visit_pricing revision can't
  // tolerate. Checking the queue is empty first means a new write only ever
  // goes straight to the server when nothing is ahead of it.
  if (navigator.onLine && (await listQueue()).length === 0) {
    const { error } = await args.attempt()
    if (!error) return { queued: false }
    if (!isNetworkFailure(error)) throw error
  }
  await enqueue(args.queueItem())
  args.applyOptimistic?.()
  return { queued: true }
}

export async function getQueueSnapshot(): Promise<QueuedMutation[]> {
  return listQueue()
}
