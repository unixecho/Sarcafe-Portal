'use client'

// The POS's one realtime connection — a MODULE-LEVEL SINGLETON (blueprint §10.2).
// Every rule below came from a bug in Ayeka's OMS:
//
//  - SIGNAL, DON'T RECONCILE. A change only says "table X is dirty"; the screen
//    refetches its own scope. Patching state from row deltas is where ordering
//    bugs, missed frames after a reconnect and RLS-filtered gaps live.
//  - ONE channel, every table listener registered BEFORE subscribe(). supabase-js
//    dedupes channels by topic and .on() THROWS once a channel is joining, so a
//    component calling it under a mounted parent crashed Ayeka's whole app through
//    its error boundary — indistinguishable from a real crash. Components cannot
//    touch the channel here: they only call subscribeRealtime(listener).
//  - A route remount must not tear the connection down: the channel outlives its
//    last subscriber by REFRESH.channelGraceMs.
//  - 150 ms debounce: one batch touches a dozen rows and the screen wants one refetch.
//  - GAP-CLOSE: on EVERY SUBSCRIBED everything is marked dirty and flushed at 0 ms —
//    anything could have changed while we were not listening, and replaying deltas
//    is exactly what we refuse to do.
//  - WATCHDOG: every 5 s, if not live for > 15 s, rebuild. Some disconnects (a
//    phone radio dropping mid-sleep) fire no CLOSED at all, so status just stops
//    updating and supabase-js has nothing to react to either. Also rebuild when the
//    browser says it is back 'online'.
//  - EACH ATTEMPT GETS ITS OWN TOPIC. removeChannel() is async, and until the leave
//    finishes the old channel is still registered under its topic — so
//    supabase.channel('pos-app') right after it hands back the SAME half-dead
//    object: .on() duplicates its bindings and .subscribe() is a no-op. (Ayeka's
//    forced rebuild needed two cycles because of this.) A fresh topic per attempt
//    ('pos-app', then 'pos-app-2', …) never collides, and waiting for the leave
//    would block the rebuild for up to 10 s in exactly the dead-socket case this
//    exists for. Callbacks of a replaced channel are ignored (generation check),
//    so its late CLOSED cannot flip a healthy new channel to 'off'.
//
// Usage: subscribe BEFORE the first fetch, so a change that lands between the two
// still produces a signal. Status listeners only observe — they neither open the
// connection nor keep it alive; only subscribeRealtime does. There is deliberately
// no hook here: components use
//   useSyncExternalStore(subscribeRealtimeStatus, getRealtimeStatus, () => 'connecting')
// and the backup poll that drives the same signal lives in the provider, not here.

import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { REALTIME_TABLES, type RealtimeTable } from './columns'
import { REFRESH } from './vocab'

export type RealtimeStatus = 'live' | 'connecting' | 'off'
export type RealtimeListener = (dirty: ReadonlySet<RealtimeTable>) => void

// ---- Pure parts (exported so the harness can pin them) ----------------------------------

/** supabase-js subscribe states -> ours. Anything unrecognised is "still trying". */
export function mapChannelStatus(raw: string): RealtimeStatus {
  switch (raw) {
    case 'SUBSCRIBED':
      return 'live'
    case 'CHANNEL_ERROR':
    case 'TIMED_OUT':
    case 'CLOSED':
      return 'off'
    default:
      return 'connecting'
  }
}

/** The watchdog's whole decision. Strictly greater: exactly 15 s of not-live is still inside the window. */
export function shouldRebuild(
  status: RealtimeStatus,
  lastLiveAt: number,
  now: number,
  deadMs: number = REFRESH.deadSocketMs,
): boolean {
  return status !== 'live' && now - lastLiveAt > deadMs
}

/** Debounce bookkeeping: the dirty set after more tables are marked. Never mutates its input. */
export function mergeDirty(current: ReadonlySet<RealtimeTable>, ...tables: RealtimeTable[]): Set<RealtimeTable> {
  const next = new Set<RealtimeTable>(current)
  for (const t of tables) next.add(t)
  return next
}

// ---- The singleton ----------------------------------------------------------------------

const TOPIC = 'pos-app'

// Each subscription is its own object so subscribing the same function twice gives two
// independent subscriptions (a Set of bare functions would collapse them, and the first
// unsubscribe would silently cancel the second).
type Sub = { fn: RealtimeListener }
type StatusSub = { fn: (status: RealtimeStatus) => void }

const subs = new Set<Sub>()
const statusSubs = new Set<StatusSub>()

let channel: RealtimeChannel | null = null
let generation = 0
let status: RealtimeStatus = 'connecting'
let lastLiveAt = 0
let pending = new Set<RealtimeTable>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let watchdog: ReturnType<typeof setInterval> | null = null
let graceTimer: ReturnType<typeof setTimeout> | null = null
let running = false

function setStatus(next: RealtimeStatus) {
  if (next === status) return
  // "Not live for how long" counts from the moment it stopped being live, so a disconnect
  // two hours into a healthy session gets the full 15 s window rather than an instant rebuild.
  // ONLY the edges into and out of 'live' move it: a socket flapping off/connecting/off must
  // still accumulate dead time, or the watchdog would never see it.
  if (status === 'live' || next === 'live') lastLiveAt = Date.now()
  status = next
  for (const s of Array.from(statusSubs)) {
    try {
      s.fn(next)
    } catch {
      /* a broken status listener must not stop the others */
    }
  }
}

function flush() {
  flushTimer = null
  if (pending.size === 0) return
  const dirty = pending
  pending = new Set()
  for (const s of Array.from(subs)) {
    try {
      s.fn(dirty)
    } catch {
      /* one broken listener must not starve the screens behind it */
    }
  }
}

function mark(table: RealtimeTable) {
  pending = mergeDirty(pending, table)
  // A fixed window, not reset by each event: the added latency is capped at the debounce.
  if (!flushTimer) flushTimer = setTimeout(flush, REFRESH.realtimeDebounceMs)
}

function markAllNow() {
  pending = mergeDirty(pending, ...REALTIME_TABLES)
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, 0)
}

/** Ask the current channel to leave. Fire-and-forget: nothing waits on it (see the header). */
function teardown() {
  generation++ // every callback of the channel being replaced is stale from this instant
  const old = channel
  channel = null
  if (!old) return
  try {
    void createClient()
      .removeChannel(old)
      .catch(() => {})
  } catch {
    /* nothing useful to do: the replacement does not depend on this finishing */
  }
}

function connect() {
  if (typeof window === 'undefined') return
  teardown() // ALWAYS first, so repeated calls are churn, never a double subscription
  const gen = generation
  setStatus('connecting')
  lastLiveAt = Date.now()
  try {
    const ch = createClient().channel(gen === 1 ? TOPIC : `${TOPIC}-${gen}`)
    channel = ch // recorded before .on() so a failure below still gets this channel removed
    for (const table of REALTIME_TABLES) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (gen === generation) mark(table)
      })
    }
    ch.subscribe((raw) => {
      if (gen !== generation) return
      const next = mapChannelStatus(raw)
      setStatus(next)
      if (next === 'live') markAllNow()
    })
  } catch {
    // Reaching here means the client itself failed (in dev, a hot-reload can leave a channel
    // registered under the first topic). The watchdog tries again under a fresh topic.
    teardown()
    setStatus('off')
  }
}

function tick() {
  if (!running) return
  const now = Date.now()
  if (now < lastLiveAt) lastLiveAt = now // the wall clock moved back: do not go blind for the difference
  if (status === 'live') {
    lastLiveAt = now
    return
  }
  if (shouldRebuild(status, lastLiveAt, now)) {
    // Reset first: a slow-but-working reconnect on weak signal gets a fresh window of its own
    // instead of being torn down again on the very next tick.
    lastLiveAt = now
    connect()
  }
}

function onOnline() {
  // The moment the network is back is worth acting on. Rebuild from scratch rather than trust
  // a socket that went stale during the outage to heal itself.
  if (running) connect()
}

function start() {
  if (running) return
  running = true
  window.addEventListener('online', onOnline)
  watchdog = setInterval(tick, REFRESH.watchdogTickMs)
  connect()
}

function stop() {
  running = false
  window.removeEventListener('online', onOnline)
  if (watchdog) clearInterval(watchdog)
  watchdog = null
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  pending = new Set()
  teardown()
  setStatus('off')
}

/**
 * Be told which tables changed (debounced, merged into one call). Connects lazily on the
 * first subscriber. Returns the unsubscribe; the connection outlives the last one by
 * REFRESH.channelGraceMs so a route remount reuses it.
 */
export function subscribeRealtime(listener: RealtimeListener): () => void {
  if (typeof window === 'undefined') return () => {}
  const sub: Sub = { fn: listener }
  subs.add(sub)
  if (graceTimer) {
    clearTimeout(graceTimer)
    graceTimer = null
  }
  start()
  return () => {
    if (!subs.delete(sub)) return
    if (subs.size === 0 && !graceTimer) {
      graceTimer = setTimeout(() => {
        graceTimer = null
        if (subs.size === 0) stop()
      }, REFRESH.channelGraceMs)
    }
  }
}

/** Observe the connection (silent when 'live'; the UI shows a pill only otherwise). Compatible with useSyncExternalStore. */
export function subscribeRealtimeStatus(listener: (status: RealtimeStatus) => void): () => void {
  const sub: StatusSub = { fn: listener }
  statusSubs.add(sub)
  return () => {
    statusSubs.delete(sub)
  }
}

export function getRealtimeStatus(): RealtimeStatus {
  return status
}
