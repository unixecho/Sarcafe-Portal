'use client'

// ============================================================================
// The LIVE STORE — the one copy of "the orders on the floor right now" that every
// screen reads. Station, Orders, the dock's backlog counts: all of them look at
// THIS, so they cannot disagree and nobody runs a second orders query.
//
//   const { orders, byId, loaded, failed, backlog, advance, voidItems, refreshNow } = useLive()
//
//   orders    every order of the open event that is still OPEN, plus any that was
//             completed / cancelled in the last hour (so "where did that order go?"
//             and the Done tray have something to show), each with its lines in
//             `items` (oldest line first). STABLE ORDER: oldest order first, and it
//             is never re-sorted by a status change or a refetch — a card that
//             jumps under a finger is the "whack-a-mole" bug (blueprint §10.3).
//             Screens that want newest-first reverse a COPY.
//   byId      the same orders, by id.
//   loaded    the first read has finished (or there is no open event, so nothing to read).
//   failed    the LAST read failed. The orders you hold are the last good ones —
//             a failed read must never look like "nothing here" (blueprint §17).
//   backlog   per point: { sent, preparing, ready, inFlight, oldestSentAt } — what
//             the dock's chips count. Derived once, here.
//
//   advance(ids, from, to)  Optimistic. Paints the new status AND its stamps at
//             once from a local overlay (the server's rows are never mutated),
//             sends it, and on a conflict / missing line / error REMOVES the
//             painting and says so in plain words ("מישהו כבר עדכן את זה"). On
//             success the painting stays until a read that started AFTER the write
//             confirms it, so there is no flicker between "painted" and "real".
//             Resolves to { ok, failed } id lists — you may ignore it.
//   voidItems(orderId, itemIds | null, reason)  null = every line not yet delivered.
//             Not optimistic (the person has just confirmed a destructive action and
//             is waiting for it anyway) but paints the server's answer instantly and
//             refetches. Resolves to the ApiResult so a sheet can show its own error.
//   refreshNow()  re-read now (coalesced with any read already running).
//
// WHY A SECOND LAYER ("overlay") INSTEAD OF EDITING THE ROWS: realtime and the
// 8 s poll replace `orders` wholesale. Patching rows in place would be erased by the
// next refetch (flicker) or, worse, would diverge from the server and stay wrong.
// An overlay is re-applied on top of every server snapshot, so the optimistic state
// survives refetches and disappears exactly when the server agrees.
//
// ONE read at a time. A burst of signals (a batch touches a dozen rows) coalesces
// into one trailing read; the read has a 15 s ceiling so a dead socket cannot freeze
// the queue forever; and a read that finishes after the event changed is discarded.
// ============================================================================

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import { posApi, type ApiResult } from '@/lib/pos/client'
import { ITEM_COLUMNS, ORDER_COLUMNS } from '@/lib/pos/columns'
import { deriveOrderStatus, orderTotalAgorot } from '@/lib/pos/lifecycle'
import { useT } from '@/lib/pos/useT'
import type { VoidResponse } from '@/lib/pos/api'
import type { ItemStatus, OrderStatus, PosItem, PosOrder, PosOrderWithItems } from '@/lib/pos/types'
import { usePos, useRefreshKey } from '../PosProvider'
import { errorText } from '../shell/errorText'
import { usePosToast } from '../shell/Toast'

// ---- public types ---------------------------------------------------------------------------

/** The statuses the server's advance endpoint speaks (everything except the soft-delete). */
export type LiveStatus = Exclude<ItemStatus, 'voided'>

export type PointBacklog = {
  sent: number
  preparing: number
  ready: number
  /** sent + preparing: work somebody still has to do */
  inFlight: number
  /** the oldest UNACCEPTED line's sent_at — what the chip's age colour is computed from */
  oldestSentAt: string | null
}

export type LiveData = {
  orders: PosOrderWithItems[]
  byId: ReadonlyMap<string, PosOrderWithItems>
  loaded: boolean
  failed: boolean
  backlog: ReadonlyMap<string, PointBacklog>
  /** epoch ms of the last successful read, or null */
  loadedAt: number | null
}

export type AdvanceOutcome = { ok: string[]; failed: string[] }

export type LiveActions = {
  advance: (ids: readonly string[], from: LiveStatus, to: LiveStatus) => Promise<AdvanceOutcome>
  voidItems: (orderId: string, itemIds: readonly string[] | null, reason: string) => Promise<ApiResult<VoidResponse>>
  refreshNow: () => void
}

// ---- knobs ----------------------------------------------------------------------------------------

/** How long a finished order stays in `orders` after it completes or is cancelled. */
const RECENT_MS = 60 * 60_000
/** A read that has not answered by now is abandoned so the next one can run. */
const READ_TIMEOUT_MS = 15_000
/** An optimistic step nobody ever confirmed or refuted is dropped after this (a leak guard, not a feature). */
const STEP_TTL_MS = 30_000

const SELECT = `${ORDER_COLUMNS}, pos_order_items(${ITEM_COLUMNS})`

// ---- the overlay ------------------------------------------------------------------------------------

type Step = {
  from: LiveStatus
  to: LiveStatus | 'voided'
  /** the client's clock when it was painted; the stamps shown use this */
  at: string
  actor: string
  voidReason?: string
  /** null until the server said OK; then the sequence number of the latest read that had STARTED */
  confirmedSeq: number | null
  created: number
}

/** The line's columns after one step — a mirror of what pos_advance_items / pos_void_items write. */
function stepPatch(row: PosItem, s: Step): Partial<PosItem> {
  if (s.to === 'voided') {
    return {
      status: 'voided',
      voided_by: s.actor,
      voided_at: s.at,
      voided_from: s.from,
      void_reason: s.voidReason ?? null,
    }
  }
  const pair = `${s.from}>${s.to}`
  const p: Partial<PosItem> = { status: s.to }
  if (s.from === 'sent' && (s.to === 'preparing' || s.to === 'ready')) {
    p.claimed_by = row.claimed_by ?? s.actor
    p.claimed_at = row.claimed_at ?? s.at
  }
  if (pair === 'preparing>sent') {
    p.claimed_by = null
    p.claimed_at = null
  }
  if (s.to === 'ready') p.ready_at = s.at
  if (pair === 'ready>preparing') p.ready_at = null
  if (s.to === 'delivered') {
    // Serve implies pickup: stamp it, never block on it.
    p.picked_up_by = row.picked_up_by ?? s.actor
    p.picked_up_at = row.picked_up_at ?? s.at
    p.delivered_by = s.actor
    p.delivered_at = s.at
  }
  if (pair === 'delivered>ready') {
    p.picked_up_by = null
    p.picked_up_at = null
    p.delivered_by = null
    p.delivered_at = null
  }
  return p
}

/** Paints a line through its pending steps IN ORDER. A step only applies while the line is where the step
 *  expects it: if the server is already past it (the write landed), or somebody else moved the line, or an
 *  earlier step was refuted, that step is SKIPPED — never forced — and a later step may still apply. The
 *  server's row always wins over a painting that no longer matches it. */
function paintLine(row: PosItem, steps: readonly Step[]): PosItem {
  let cur = row
  for (const s of steps) {
    if (cur.status !== s.from) continue
    cur = { ...cur, ...stepPatch(cur, s) }
  }
  return cur
}

function paintOrders(server: PosOrderWithItems[], overlay: ReadonlyMap<string, Step[]>): PosOrderWithItems[] {
  if (overlay.size === 0) return server
  let any = false
  const out = server.map((o) => {
    let touched = false
    let lastAt = ''
    const items = o.items.map((it) => {
      const steps = overlay.get(it.id)
      if (!steps) return it
      const next = paintLine(it, steps)
      if (next !== it) {
        touched = true
        for (const s of steps) if (s.at > lastAt) lastAt = s.at
      }
      return next
    })
    if (!touched) return o
    any = true
    // The order's own status is DERIVED from its lines (pos_recompute_order); repaint it the same way.
    const status: OrderStatus = deriveOrderStatus(items)
    const patch: Partial<PosOrder> = { total_agorot: orderTotalAgorot(items) }
    if (status !== o.status) {
      patch.status = status
      patch.completed_at = status === 'completed' ? lastAt : null
      patch.voided_at = status === 'void' ? lastAt : null
    }
    return { ...o, ...patch, items }
  })
  return any ? out : server
}

// ---- reading ------------------------------------------------------------------------------------------

type RawOrder = PosOrder & { pos_order_items?: PosItem[] | null }

function normalise(raw: RawOrder[]): PosOrderWithItems[] {
  return raw.map((r) => {
    const { pos_order_items, ...order } = r
    // `?? []` on every array that might be absent: a missing one crashed Ayeka's station screen.
    const items = (pos_order_items ?? []).map((i) => (Array.isArray(i.modifiers) ? i : { ...i, modifiers: [] }))
    return { ...order, items }
  })
}

const EMPTY: PosOrderWithItems[] = []
const EMPTY_BACKLOG: ReadonlyMap<string, PointBacklog> = new Map()

function computeBacklog(orders: readonly PosOrderWithItems[]): ReadonlyMap<string, PointBacklog> {
  const m = new Map<string, PointBacklog>()
  for (const o of orders) {
    if (o.status === 'void') continue
    for (const it of o.items) {
      if (it.status !== 'sent' && it.status !== 'preparing' && it.status !== 'ready') continue
      const b = m.get(it.point_id) ?? { sent: 0, preparing: 0, ready: 0, inFlight: 0, oldestSentAt: null }
      if (it.status === 'sent') {
        b.sent++
        b.inFlight++
        if (!b.oldestSentAt || it.sent_at < b.oldestSentAt) b.oldestSentAt = it.sent_at
      } else if (it.status === 'preparing') {
        b.preparing++
        b.inFlight++
      } else {
        b.ready++
      }
      m.set(it.point_id, b)
    }
  }
  return m
}

/** Run `run` only after every earlier call that touched any of these lines has settled. `run` never throws
 *  (posApi folds every failure into its result), but the chain is built to survive it anyway. */
function serialByLine<T>(settled: Map<string, Promise<void>>, ids: readonly string[], run: () => Promise<T>): Promise<T> {
  const waits = ids.map((id) => settled.get(id)).filter((p): p is Promise<void> => !!p)
  const job = waits.length ? Promise.all(waits).then(run) : run()
  const done: Promise<void> = job.then(
    () => undefined,
    () => undefined,
  )
  for (const id of ids) settled.set(id, done)
  void done.then(() => {
    for (const id of ids) if (settled.get(id) === done) settled.delete(id)
  })
  return job
}

// ---- contexts ----------------------------------------------------------------------------------------------

const DataCtx = createContext<LiveData | null>(null)
const ActionsCtx = createContext<LiveActions | null>(null)

export function useLiveData(): LiveData {
  const v = useContext(DataCtx)
  if (!v) throw new Error('useLiveData() needs <PosApp> above it.')
  return v
}
/** Actions only — stable identities, so a component that merely triggers advance() never re-renders on a refetch. */
export function useLiveActions(): LiveActions {
  const v = useContext(ActionsCtx)
  if (!v) throw new Error('useLiveActions() needs <PosApp> above it.')
  return v
}
export function useLive(): LiveData & LiveActions {
  const data = useLiveData()
  const actions = useLiveActions()
  return useMemo(() => ({ ...data, ...actions }), [data, actions])
}

// ---- the provider ----------------------------------------------------------------------------------------------

export function LiveProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const { toast } = usePosToast()
  const { me, branchId, session } = usePos()
  const refreshKey = useRefreshKey()
  const sessionId = session?.id ?? null

  const [serverOrders, setServerOrders] = useState<PosOrderWithItems[]>(EMPTY)
  const [overlayVersion, setOverlayVersion] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)

  const overlay = useRef(new Map<string, Step[]>())
  const bumpOverlay = useCallback(() => setOverlayVersion((v) => v + 1), [])

  // Latest values for callbacks that outlive a render.
  const t_ = useRef(t)
  t_.current = t
  const toast_ = useRef(toast)
  toast_.current = toast
  const meId = useRef(me.id)
  meId.current = me.id
  const branchRef = useRef(branchId)
  branchRef.current = branchId
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId

  // ---- the read: one at a time, coalesced, abandoned if it hangs, discarded if the event changed ----

  const busy = useRef(false)
  const queued = useRef(false)
  const startedSeq = useRef(0)
  /** Reuse an order's object when its content did not change, so memoised cards skip the refetch entirely. */
  const stable = useRef(new Map<string, { sig: string; obj: PosOrderWithItems }>())
  const serverRef = useRef<PosOrderWithItems[]>(EMPTY)

  const commitServer = useCallback((next: PosOrderWithItems[]) => {
    const prevMap = stable.current
    const nextMap = new Map<string, { sig: string; obj: PosOrderWithItems }>()
    const reused = next.map((o) => {
      const sig = JSON.stringify(o)
      const prev = prevMap.get(o.id)
      const obj = prev && prev.sig === sig ? prev.obj : o
      nextMap.set(o.id, { sig, obj })
      return obj
    })
    stable.current = nextMap
    const cur = serverRef.current
    const same = cur.length === reused.length && cur.every((o, i) => o === reused[i])
    if (!same) {
      serverRef.current = reused
      setServerOrders(reused)
    }
  }, [])

  /** Drop painting the server has now caught up with, and painting nobody ever settled. */
  const collect = useCallback(
    (readSeq: number) => {
      const now = Date.now()
      let changed = false
      overlay.current.forEach((steps, id) => {
        const kept = steps.filter(
          (s) => !(s.confirmedSeq !== null && readSeq > s.confirmedSeq) && now - s.created < STEP_TTL_MS,
        )
        if (kept.length !== steps.length) {
          changed = true
          if (kept.length) overlay.current.set(id, kept)
          else overlay.current.delete(id)
        }
      })
      if (changed) bumpOverlay()
    },
    [bumpOverlay],
  )

  const load = useCallback(async () => {
    if (busy.current) {
      queued.current = true
      return
    }
    busy.current = true
    const seq = ++startedSeq.current
    const forSession = sessionRef.current
    try {
      if (!forSession) {
        // No open event: there is nothing to read, and that is a real, empty answer.
        commitServer(EMPTY)
        setLoaded(true)
        setFailed(false)
        collect(seq)
        return
      }
      const ctrl = new AbortController()
      const timer = window.setTimeout(() => ctrl.abort(), READ_TIMEOUT_MS)
      const since = new Date(Date.now() - RECENT_MS).toISOString()
      let result: { data: unknown; error: unknown }
      try {
        result = await createClient()
          .from('pos_orders')
          .select(SELECT)
          .eq('session_id', forSession)
          .or(
            `status.eq.open,and(status.eq.completed,completed_at.gte.${since}),and(status.eq.void,voided_at.gte.${since})`,
          )
          .order('created_at', { ascending: true })
          .order('ticket_no', { ascending: true })
          .order('seq', { ascending: true, referencedTable: 'pos_order_items' })
          .abortSignal(ctrl.signal)
      } finally {
        window.clearTimeout(timer)
      }
      // The event changed while we were reading: this answer belongs to the old one.
      if (sessionRef.current !== forSession) return
      if (result.error || !Array.isArray(result.data)) {
        setFailed(true)
        return
      }
      commitServer(normalise(result.data as RawOrder[]))
      setLoaded(true)
      setFailed(false)
      setLoadedAt(Date.now())
      collect(seq)
    } catch {
      // Offline, aborted, or the server fell over. Keep what we hold, and SAY the read failed.
      if (sessionRef.current === forSession) setFailed(true)
    } finally {
      busy.current = false
      if (queued.current) {
        queued.current = false
        void load()
      }
    }
  }, [collect, commitServer])

  // A different event (or the first one): start from a clean slate.
  useEffect(() => {
    overlay.current.clear()
    stable.current = new Map()
    serverRef.current = EMPTY
    setServerOrders(EMPTY)
    setLoaded(false)
    setFailed(false)
    setLoadedAt(null)
    bumpOverlay()
    void load()
  }, [sessionId, load, bumpOverlay])

  // Every signal — socket, 8 s poll, tab visible — lands here as a bump.
  useEffect(() => {
    if (refreshKey > 0) void load()
  }, [refreshKey, load])

  // ---- what the screens see: server rows with the overlay painted on top -----------------------------

  const orders = useMemo(
    () => paintOrders(serverOrders, overlay.current),
    // overlayVersion is the signal that the (mutable) overlay changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverOrders, overlayVersion],
  )
  const ordersRef = useRef(orders)
  ordersRef.current = orders

  const byId = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const backlog = useMemo(() => (orders.length ? computeBacklog(orders) : EMPTY_BACKLOG), [orders])

  // ---- actions ------------------------------------------------------------------------------------------------

  /** Two taps on the same line must reach the server in the order they were made. */
  const settled = useRef(new Map<string, Promise<void>>())
  const serial = useCallback(
    <T,>(ids: readonly string[], run: () => Promise<T>): Promise<T> => serialByLine(settled.current, ids, run),
    [],
  )

  const addSteps = useCallback((ids: readonly string[], make: (id: string) => Step | null): Map<string, Step> => {
    const added = new Map<string, Step>()
    for (const id of ids) {
      const step = make(id)
      if (!step) continue
      overlay.current.set(id, [...(overlay.current.get(id) ?? []), step])
      added.set(id, step)
    }
    return added
  }, [])

  const removeSteps = useCallback((added: ReadonlyMap<string, Step>, only?: ReadonlySet<string>) => {
    added.forEach((step, id) => {
      if (only && !only.has(id)) return
      const left = (overlay.current.get(id) ?? []).filter((s) => s !== step)
      if (left.length) overlay.current.set(id, left)
      else overlay.current.delete(id)
    })
  }, [])

  const refreshNow = useCallback(() => {
    void load()
  }, [load])

  const advance = useCallback<LiveActions['advance']>(
    async (idsIn, from, to) => {
      const ids = Array.from(new Set(idsIn))
      if (ids.length === 0) return { ok: [], failed: [] }
      const at = new Date().toISOString()
      const actor = meId.current

      // 1. Paint now. No round trip is ever on the hot tap path.
      const added = addSteps(ids, () => ({ from, to, at, actor, confirmedSeq: null, created: Date.now() }))
      bumpOverlay()

      // 2. Send, in order per line.
      const r = await serial(ids, () => posApi.advance({ branchId: branchRef.current, ids, from, to }))

      if (!r.ok) {
        // Nothing was written (or we cannot know): take the painting back and say why.
        removeSteps(added)
        bumpOverlay()
        toast_.current(r.code === 'conflict' ? t_.current('core.toast.someoneElse') : errorText(t_.current, r.code), {
          tone: r.code === 'conflict' ? 'warn' : 'error',
        })
        void load()
        return { ok: [], failed: ids }
      }

      const okSet = new Set(r.data.ok)
      const lost = new Set(ids.filter((id) => !okSet.has(id)))
      // Confirmed lines keep their painting until a read that began AFTER now agrees;
      // refuted ones (conflict / gone) lose it at once.
      added.forEach((step, id) => {
        if (okSet.has(id)) step.confirmedSeq = startedSeq.current
      })
      if (lost.size) {
        removeSteps(added, lost)
        // "Someone already updated this" — the person's tap lost a race, which is normal, not an error.
        toast_.current(t_.current('core.toast.someoneElse'), { tone: 'warn' })
      }
      bumpOverlay()
      void load()
      return { ok: ids.filter((id) => okSet.has(id)), failed: Array.from(lost) }
    },
    [addSteps, bumpOverlay, load, removeSteps, serial],
  )

  const voidItems = useCallback<LiveActions['voidItems']>(
    async (orderId, itemIdsIn, reason) => {
      const order = ordersRef.current.find((o) => o.id === orderId)
      const wanted = itemIdsIn
        ? new Set(itemIdsIn)
        : new Set((order?.items ?? []).filter((i) => i.status !== 'delivered' && i.status !== 'voided').map((i) => i.id))
      const idsForOrdering = Array.from(wanted)

      const r = await serial(idsForOrdering, () =>
        posApi.voidItems(orderId, {
          branchId: branchRef.current,
          itemIds: itemIdsIn ? Array.from(itemIdsIn) : null,
          reason,
        }),
      )
      if (!r.ok) {
        toast_.current(errorText(t_.current, r.code), { tone: 'error' })
        void load()
        return r
      }
      const at = new Date().toISOString()
      const actor = meId.current
      const voided = new Set(r.data.voided)
      addSteps(Array.from(voided), (id) => {
        const line = ordersRef.current.flatMap((o) => o.items).find((i) => i.id === id)
        if (!line || line.status === 'voided') return null
        return {
          from: line.status as LiveStatus,
          to: 'voided',
          at,
          actor,
          voidReason: reason,
          // Already confirmed by the server's own answer: it only waits for a read to catch up.
          confirmedSeq: startedSeq.current,
          created: Date.now(),
        }
      })
      bumpOverlay()
      void load()
      return r
    },
    [addSteps, bumpOverlay, load, serial],
  )

  const actions = useMemo<LiveActions>(() => ({ advance, voidItems, refreshNow }), [advance, voidItems, refreshNow])
  const data = useMemo<LiveData>(
    () => ({ orders, byId, loaded, failed, backlog, loadedAt }),
    [orders, byId, loaded, failed, backlog, loadedAt],
  )

  return (
    <ActionsCtx.Provider value={actions}>
      <DataCtx.Provider value={data}>{children}</DataCtx.Provider>
    </ActionsCtx.Provider>
  )
}
