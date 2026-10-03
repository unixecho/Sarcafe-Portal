'use client'

// The order outbox (blueprint §10.4) — the cashier device's promise that a paid-for
// order is never lost to a Wi-Fi drop. By the time the cashier types, the customer has
// ALREADY paid on the HYP terminal; "the order never reached the kitchen" is the worst
// failure this system can have, so sending is not a button press, it is a queue.
//
// What is queued, and what is not:
//  - Only order CREATION is outboxed. It is the one write that is idempotent on
//    `client_key` (the server answers a retry with the original order and
//    `deduped: true`), which is what makes blind retrying safe. Item additions, edits,
//    voids and station taps are DIRECT calls with an immediate, honest error: retrying
//    them blindly could double-add a line or re-apply a stale tap, and the person
//    pressing them is looking at the screen and can simply press again.
//  - The outbox holds INTENTS, never state. Whether an order exists is the server's
//    answer, not anything in here.
//
// How an entry moves:
//   pending --send--> sending --ok--> (removed, subscribers told)
//                        |--transient failure (network, 5xx, 429)--> pending, after a backoff
//                        `--permanent failure (the server refused the content)--> attention
//  Transient failures retry forever with exponential backoff. A permanent failure STOPS
//  retrying — sending the same refused order again can only fail again — and the entry
//  waits in `attention` with the reason. NOTHING is dropped silently: an entry leaves the
//  queue only when the server accepted it or when someone calls discard() (the UI puts a
//  ConfirmSheet in front of that). To fix a refused order the UI discards it and enqueues
//  an edited copy under a NEW key; the old entry's `body` is there to prefill the form.
//
// Pacing, because event Wi-Fi fails in specific ways:
//  - One send at a time, FIFO by queue time. A pending entry that is not due yet does not
//    block a later one that is (a poison-pill order must not freeze the whole queue), and
//    an entry in `attention` never blocks anything.
//  - A network failure or a 429 is about the device or the server, not about one order, so
//    it pushes EVERY pending entry's next attempt out to the same moment instead of making
//    each one fail in turn. A 5xx only delays its own entry.
//  - Backoff protects a struggling server, not a device that was offline: when the browser
//    says it is back 'online', or the tab is foregrounded, pending entries become due at once.
//
// Persistence: localStorage under OUTBOX.storageKeyPrefix + branchId. Every read and write
// is in try/catch — private mode or a full quota degrades to in-memory (the queue still
// works until the tab closes). It holds the customer's phone until the server accepts the
// order, then the entry is gone. A `storage` listener makes the last write from ANOTHER tab
// win (except an entry this tab is mid-send on), so a stale second tab cannot overwrite the
// first tab's queue with its own old copy.

import { useMemo, useSyncExternalStore } from 'react'
import type { CreateOrderBody, CreateOrderResponse } from './api'
import { posApi, type ApiFailure, type ApiResult } from './client'
import { OUTBOX } from './vocab'

// ---- Types ------------------------------------------------------------------------------

export type OutboxState = 'pending' | 'sending' | 'attention'

export type OutboxEntry = {
  /** The idempotency key — generated once, reused by every retry, never by a re-submission. */
  clientKey: string
  queuedAt: number
  body: CreateOrderBody
  /** Send attempts made so far (counted when an attempt STARTS). */
  attempts: number
  state: OutboxState
  /** Epoch ms; a pending entry is due when this has passed. */
  nextAttemptAt: number
  /** The last failure, for the "needs attention" reason and the retrying hint. */
  lastError?: { code: string; message: string }
}

export type OutboxDraft = Omit<CreateOrderBody, 'clientKey' | 'branchId'>

export type OutboxSent = { clientKey: string; ticketNo: number; totalAgorot: number; deduped: boolean }

// ---- Pure parts (exported so the harness can pin them) -----------------------------------

/** Codes the server uses when it REFUSES the content: resending the same order cannot succeed. */
const PERMANENT_CODES: ReadonlySet<string> = new Set([
  'sold_out', 'type_sold_out', 'modifier_unavailable', 'no_session', 'no_point', 'not_sold', 'not_enabled',
  'needs_handle', 'forbidden', 'unauthorized', 'conflict', 'not_found', 'order_void',
  'unknown_item', 'unknown_type', 'unknown_modifier', 'no_price', 'needs_price_choice', 'needs_type',
  'modifier_required', 'modifier_too_many', 'modifier_too_few', 'modifier_qty',
])

/**
 * Should a failed send be retried automatically?
 *  - transient: it never got an answer (network / status 0), the server is struggling (5xx),
 *    or it asked us to slow down (429 / rate_limited). The order itself may be perfectly fine.
 *  - permanent: the server answered and said no — sold_out, no_session, bad_*, forbidden,
 *    unauthorized, a 409 conflict, any other 4xx. A retry would repeat the refusal.
 * A code the server uses to refuse content wins over the status line: it told us why.
 */
export function classifyFailure(f: { status: number; code: string }): 'transient' | 'permanent' {
  if (f.code === 'network' || f.status === 0) return 'transient'
  if (f.status === 429 || f.code === 'rate_limited') return 'transient'
  if (PERMANENT_CODES.has(f.code) || f.code.startsWith('bad_')) return 'permanent'
  if (f.status >= 500) return 'transient'
  return 'permanent'
}

/**
 * Wait before the next attempt, given how many attempts have FAILED so far: backoffMs(1) is the
 * wait after the first failure (OUTBOX.backoffStartMs), doubling each time up to OUTBOX.backoffCapMs.
 * No jitter: one cashier device, nothing to stampede. 0 or less is treated as 1.
 */
export function backoffMs(attempts: number): number {
  const n = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1
  // Clamped before the power so a huge count cannot overflow to Infinity on its way to the cap.
  return Math.min(OUTBOX.backoffCapMs, OUTBOX.backoffStartMs * 2 ** Math.min(n - 1, 20))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function sanitizeEntry(item: unknown): OutboxEntry | null {
  if (!isRecord(item)) return null
  const { clientKey, body } = item
  if (typeof clientKey !== 'string' || !UUID.test(clientKey)) return null
  // Structural only — the server's strict schema is the real validator, and an entry it refuses
  // lands in `attention` rather than vanishing. This just rejects what cannot even be sent.
  if (
    !isRecord(body) ||
    body.clientKey !== clientKey ||
    typeof body.branchId !== 'string' ||
    typeof body.customerName !== 'string' ||
    !Array.isArray(body.lines) ||
    body.lines.length === 0
  ) {
    return null
  }
  const entry: OutboxEntry = {
    clientKey,
    queuedAt: finite(item.queuedAt) && item.queuedAt >= 0 ? item.queuedAt : 0,
    body: body as unknown as CreateOrderBody,
    attempts: typeof item.attempts === 'number' && Number.isInteger(item.attempts) && item.attempts >= 0 ? item.attempts : 0,
    // A 'sending' entry means the page died mid-request. Whether the server got it is unknowable,
    // and that is exactly what idempotency is for: it goes back to pending and is sent again.
    state: item.state === 'attention' ? 'attention' : 'pending',
    nextAttemptAt: finite(item.nextAttemptAt) ? item.nextAttemptAt : 0,
  }
  const err = item.lastError
  if (isRecord(err) && typeof err.code === 'string' && typeof err.message === 'string') {
    entry.lastError = { code: err.code.slice(0, 60), message: err.message.slice(0, 200) }
  }
  return entry
}

/**
 * Whatever came out of localStorage (the raw string or the parsed value) -> a clean queue.
 * NEVER throws: corrupt storage must not take the register down. Drops entries with a
 * malformed clientKey or body, collapses duplicate keys (first wins), resets 'sending' to
 * 'pending', and returns FIFO order by queue time (stable for ties).
 */
export function sanitizeOutbox(raw: unknown): OutboxEntry[] {
  let list: unknown = raw
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: OutboxEntry[] = []
  for (const item of list) {
    const entry = sanitizeEntry(item)
    if (!entry || seen.has(entry.clientKey)) continue
    seen.add(entry.clientKey)
    out.push(entry)
  }
  return out.sort((a, b) => a.queuedAt - b.queuedAt)
}

/**
 * The entry to send next, or null. One at a time: null while anything is mid-send. Otherwise the
 * earliest-queued PENDING entry whose time has come — `attention` entries are never due, and a
 * pending entry still in backoff does not hold up a later one that is ready.
 */
export function nextDue(entries: readonly OutboxEntry[], now: number): OutboxEntry | null {
  if (entries.some((e) => e.state === 'sending')) return null
  let best: OutboxEntry | null = null
  for (const e of entries) {
    if (e.state !== 'pending' || e.nextAttemptAt > now) continue
    if (!best || e.queuedAt < best.queuedAt) best = e
  }
  return best
}

/** When the timer should next wake: the earliest `nextAttemptAt` among pending entries, or null if none wait. */
export function nextWakeAt(entries: readonly OutboxEntry[]): number | null {
  let at: number | null = null
  for (const e of entries) if (e.state === 'pending' && (at === null || e.nextAttemptAt < at)) at = e.nextAttemptAt
  return at
}

// ---- The store (browser) --------------------------------------------------------------------

export type OutboxStore = {
  subscribe: (onChange: () => void) => () => void
  /** The same array reference until something changes (what useSyncExternalStore needs). */
  getSnapshot: () => readonly OutboxEntry[]
  /** Queue an order for sending and return its idempotency key. Never fails silently: it is queued or it throws. */
  enqueueCreate: (draft: OutboxDraft) => string
  /** Send an `attention` (or backing-off) entry again, now. Ignored while that entry is mid-send. */
  retry: (clientKey: string) => void
  /** Remove an entry for good. Ignored while it is mid-send — the answer is seconds away. */
  discard: (clientKey: string) => void
  /** Called once per order the server accepts. Returns the unsubscribe. */
  onSent: (cb: (sent: OutboxSent) => void) => () => void
  /** Detach the window listeners and the timer. The shared per-branch store is never disposed; this is for tests. */
  dispose: () => void
}

/** crypto.randomUUID() only exists in secure contexts, and a tablet on http://192.168.x.x is not one. */
function uuidv4(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`
}

const NETWORK_FAILURE: ApiFailure = { ok: false, status: 0, code: 'network', message: 'אין חיבור כרגע / No connection right now' }

/**
 * A NEW store per call (it owns timers and window listeners). Components never call this —
 * useOutbox() shares one store per branch, because two flushers on one queue would each send
 * every entry. Exported for the harness and for the hook.
 */
export function createOutboxStore(branchId: string): OutboxStore {
  const key = OUTBOX.storageKeyPrefix + branchId
  const changeListeners = new Set<{ fn: () => void }>()
  const sentListeners = new Set<{ fn: (sent: OutboxSent) => void }>()
  let flushing = false
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null

  function readStorage(): OutboxEntry[] {
    try {
      const raw = window.localStorage.getItem(key)
      return raw ? sanitizeOutbox(raw) : []
    } catch {
      return []
    }
  }

  function writeStorage(list: readonly OutboxEntry[]) {
    try {
      if (list.length === 0) window.localStorage.removeItem(key)
      else window.localStorage.setItem(key, JSON.stringify(list))
    } catch {
      /* private mode or quota: the in-memory queue carries on */
    }
  }

  // A reload is a fresh start: whatever backoff an entry was in belongs to a session that is gone.
  let entries: readonly OutboxEntry[] = readStorage().map((e) => (e.state === 'pending' ? { ...e, nextAttemptAt: 0 } : e))
  // Strictly increasing within this tab, so two enqueues in one millisecond (or a clock that steps back)
  // can never be sent out of the order they were typed.
  let lastQueuedAt = entries.reduce((m, e) => Math.max(m, e.queuedAt), 0)

  function emit() {
    for (const l of Array.from(changeListeners)) {
      try {
        l.fn()
      } catch {
        /* a broken subscriber must not stop the queue */
      }
    }
  }

  function commit(next: readonly OutboxEntry[]) {
    entries = next
    writeStorage(next)
    emit()
  }

  const patch = (clientKey: string, fn: (e: OutboxEntry) => OutboxEntry) =>
    entries.map((e) => (e.clientKey === clientKey ? fn(e) : e))

  function schedule() {
    if (timer) clearTimeout(timer)
    timer = null
    if (disposed || flushing) return
    const at = nextWakeAt(entries)
    if (at === null) return
    // setTimeout silently fires at once above ~24.8 days; nothing here waits anywhere near that.
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, Math.min(Math.max(0, at - Date.now()), 2_000_000_000))
  }

  function emitSent(sent: OutboxSent) {
    for (const l of Array.from(sentListeners)) {
      try {
        l.fn(sent)
      } catch {
        /* same */
      }
    }
  }

  function recordFailure(clientKey: string, attempts: number, res: ApiFailure) {
    const lastError = { code: String(res.code).slice(0, 60), message: String(res.message).slice(0, 200) }
    if (classifyFailure(res) === 'permanent') {
      commit(patch(clientKey, (e) => ({ ...e, state: 'attention', lastError })))
      return
    }
    const at = Date.now() + backoffMs(attempts)
    // The device is offline or the server asked for quiet: that is true of every entry, so they wait together.
    const systemic = res.status === 0 || res.status === 429
    commit(
      entries.map((e) => {
        if (e.clientKey === clientKey) return { ...e, state: 'pending' as const, nextAttemptAt: at, lastError }
        if (systemic && e.state === 'pending' && e.nextAttemptAt < at) return { ...e, nextAttemptAt: at }
        return e
      }),
    )
  }

  async function send(entry: OutboxEntry) {
    const attempts = entry.attempts + 1
    commit(patch(entry.clientKey, (e) => ({ ...e, state: 'sending' as const, attempts })))
    let res: ApiResult<CreateOrderResponse>
    try {
      res = await posApi.createOrder(entry.body)
    } catch {
      res = NETWORK_FAILURE // posApi never throws; this is the belt over the braces
    }
    if (res.ok) {
      const order = res.data?.order
      if (order && typeof order.ticketNo === 'number') {
        commit(entries.filter((e) => e.clientKey !== entry.clientKey))
        emitSent({
          clientKey: entry.clientKey,
          ticketNo: order.ticketNo,
          totalAgorot: typeof order.totalAgorot === 'number' ? order.totalAgorot : 0,
          deduped: res.data.deduped === true,
        })
        return
      }
      // A 2xx we cannot read. The order may or may not exist; resending is safe (idempotent) and
      // dropping it is not, so it stays queued.
      recordFailure(entry.clientKey, attempts, NETWORK_FAILURE)
      return
    }
    recordFailure(entry.clientKey, attempts, res)
  }

  async function flush() {
    if (flushing || disposed) return
    flushing = true
    try {
      // The cap is a seatbelt: every send leaves its entry not-due-now or gone, so the loop always ends.
      for (let i = 0; i < 500 && !disposed; i++) {
        const next = nextDue(entries, Date.now())
        if (!next) break
        try {
          await send(next)
        } catch {
          // Something unforeseen inside send(). Leaving the entry 'sending' would freeze the whole queue
          // (nextDue refuses to start another send), so put it back with a delay.
          recordFailure(next.clientKey, next.attempts + 1, NETWORK_FAILURE)
        }
      }
    } finally {
      flushing = false
    }
    schedule()
  }

  /** Conditions changed (network back, tab foregrounded): stop waiting out backoffs and try now. */
  function kick() {
    if (disposed) return
    const now = Date.now()
    let changed = false
    const next = entries.map((e) => {
      if (e.state !== 'pending' || e.nextAttemptAt <= now) return e
      changed = true
      return { ...e, nextAttemptAt: now }
    })
    if (changed) commit(next)
    void flush()
  }

  const onOnline = () => kick()
  const onVisible = () => {
    if (document.visibilityState === 'visible') kick()
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== key) return
    // The other tab's write wins, except for the entry this tab is in the middle of sending.
    const inFlight = entries.find((x) => x.state === 'sending')
    const fromDisk = readStorage().filter((x) => !inFlight || x.clientKey !== inFlight.clientKey)
    entries = inFlight ? [...fromDisk, inFlight].sort((a, b) => a.queuedAt - b.queuedAt) : fromDisk
    emit()
    schedule()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisible)
    // Entries restored from a previous session start sending as soon as anything is listening.
    setTimeout(() => void flush(), 0)
  }

  return {
    subscribe(onChange) {
      const l = { fn: onChange }
      changeListeners.add(l)
      return () => {
        changeListeners.delete(l)
      }
    },
    getSnapshot: () => entries,
    enqueueCreate(draft) {
      const clientKey = uuidv4()
      lastQueuedAt = Math.max(Date.now(), lastQueuedAt + 1)
      const body: CreateOrderBody = { ...draft, branchId, clientKey }
      commit([
        ...entries,
        { clientKey, queuedAt: lastQueuedAt, body, attempts: 0, state: 'pending', nextAttemptAt: 0 },
      ])
      void flush()
      return clientKey
    },
    retry(clientKey) {
      const target = entries.find((e) => e.clientKey === clientKey)
      if (!target || target.state === 'sending') return
      commit(
        patch(clientKey, (e) => {
          const { lastError, ...rest } = e
          void lastError // dropped on purpose: the entry is no longer failed, it is queued again
          return { ...rest, state: 'pending' as const, attempts: 0, nextAttemptAt: 0 }
        }),
      )
      void flush()
    },
    discard(clientKey) {
      const target = entries.find((e) => e.clientKey === clientKey)
      if (!target || target.state === 'sending') return
      commit(entries.filter((e) => e.clientKey !== clientKey))
    },
    onSent(cb) {
      const l = { fn: cb }
      sentListeners.add(l)
      return () => {
        sentListeners.delete(l)
      }
    },
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      timer = null
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline)
        window.removeEventListener('storage', onStorage)
        document.removeEventListener('visibilitychange', onVisible)
      }
    },
  }
}

// ---- The hook --------------------------------------------------------------------------------

const NO_ENTRIES: readonly OutboxEntry[] = Object.freeze([])

/** What the server render sees (and the hydration pass): an empty queue, no timers, no listeners. */
const SERVER_STORE: OutboxStore = {
  subscribe: () => () => {},
  getSnapshot: () => NO_ENTRIES,
  enqueueCreate: () => {
    throw new Error('The order outbox only exists in the browser.')
  },
  retry: () => {},
  discard: () => {},
  onSent: () => () => {},
  dispose: () => {},
}

const stores = new Map<string, OutboxStore>()

function storeFor(branchId: string): OutboxStore {
  if (typeof window === 'undefined') return SERVER_STORE
  let s = stores.get(branchId)
  if (!s) {
    s = createOutboxStore(branchId)
    stores.set(branchId, s)
  }
  return s
}

export type OutboxApi = {
  entries: readonly OutboxEntry[]
  /** Orders the server has not accepted yet (waiting or mid-send) — the register's outbox pill. */
  pendingCount: number
  /** Orders the server refused and a person must look at. */
  attentionCount: number
  enqueueCreate: OutboxStore['enqueueCreate']
  retry: OutboxStore['retry']
  discard: OutboxStore['discard']
  onSent: OutboxStore['onSent']
}

export function useOutbox(branchId: string): OutboxApi {
  const store = storeFor(branchId)
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot, () => NO_ENTRIES)
  return useMemo(
    () => ({
      entries,
      pendingCount: entries.filter((e) => e.state !== 'attention').length,
      attentionCount: entries.filter((e) => e.state === 'attention').length,
      enqueueCreate: store.enqueueCreate,
      retry: store.retry,
      discard: store.discard,
      onSent: store.onSent,
    }),
    [entries, store],
  )
}
