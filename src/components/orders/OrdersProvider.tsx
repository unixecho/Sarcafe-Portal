'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useOrdersRealtime } from '@/lib/orders/useOrdersRealtime'
import type { OrderAction } from '@/lib/orders/actions'
import type { Order, OrderAccess, OrdersBoard } from '@/lib/orders/types'
import type { MenuCategory } from '@/lib/menu/types'

const POLL_MS = 15_000

type DispatchOutcome = { ok: true; orderId?: string; orderNumber?: number; access?: OrderAccess } | { ok: false; error: string }

type OrdersContextValue = {
  branchSlug: string
  board: OrdersBoard | null
  catalog: MenuCategory[]
  loading: boolean
  error: string | null
  /** Applies the action's expected result to the board immediately, then
   *  sends it and reconciles against a fresh server read. The server
   *  remains the only authority — see applyOptimistic() below. */
  dispatch: (action: OrderAction) => Promise<DispatchOutcome>
  refresh: () => Promise<void>
}

const OrdersContext = createContext<OrdersContextValue | null>(null)

/** Applies an action's *expected* outcome to the board in the same frame
 *  as the tap, instead of after two sequential network round trips (the
 *  dispatch POST, then a full board re-read). That serial wait is what
 *  made the register feel laggy on a truck's mobile connection: every
 *  status tap froze its card for the length of both.
 *
 *  The server stays the sole authority. Each dispatch still reconciles
 *  against a fresh read when it settles, and a rejected one snaps
 *  straight back, so a wrong guess here is visible for a few hundred ms
 *  rather than persisting. Only the fields OrderCard actually renders are
 *  patched — the lifecycle timestamps it ignores are left for the real
 *  read to fill in rather than being faked here. */
function applyOptimistic(board: OrdersBoard, action: OrderAction): OrdersBoard {
  switch (action.type) {
    case 'advanceStatus': {
      const order = board.active.find((o) => o.id === action.orderId)
      if (!order) return board
      const next: Order = { ...order, status: action.toStatus }
      // completed/cancelled leave the working queue for today's history,
      // which is newest-first — matching loadOrdersBoard()'s own ordering
      // so the reconcile doesn't visibly reshuffle the list.
      if (action.toStatus === 'completed') {
        return {
          ...board,
          active: board.active.filter((o) => o.id !== order.id),
          history: [{ ...next, completedAt: new Date().toISOString() }, ...board.history],
        }
      }
      return { ...board, active: board.active.map((o) => (o.id === order.id ? next : o)) }
    }

    case 'cancelOrder': {
      const order = board.active.find((o) => o.id === action.orderId)
      if (!order) return board
      return {
        ...board,
        active: board.active.filter((o) => o.id !== order.id),
        history: [
          { ...order, status: 'cancelled', cancelReason: action.reason ?? null, cancelledAt: new Date().toISOString() },
          ...board.history,
        ],
      }
    }

    case 'setPayment': {
      const patch = (o: Order): Order =>
        o.id === action.orderId ? { ...o, paymentStatus: action.status, paymentMethod: action.method ?? o.paymentMethod } : o
      return { ...board, active: board.active.map(patch), history: board.history.map(patch) }
    }

    default:
      // createOrder's order number and access token, and
      // regenerateAccess's fresh token, are all server-minted — there is
      // nothing truthful to show before the response arrives.
      return board
  }
}

export default function OrdersProvider({ branchSlug, children }: { branchSlug: string; children: ReactNode }) {
  const [board, setBoard] = useState<OrdersBoard | null>(null)
  const [catalog, setCatalog] = useState<MenuCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // How many dispatches are currently in flight. A background refresh
  // (poll, realtime nudge, tab refocus) that resolves while one is
  // pending was computed BEFORE that write landed, so applying it would
  // visibly bounce the card back to its old status for a moment. Those
  // results are dropped; the dispatch issues its own reconcile once the
  // last one settles.
  const inFlightRef = useRef(0)

  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!branchSlug) return
      if (!silent) setLoading(true)
      try {
        // The catalog is the branch's published menu — it can't change
        // from this screen and effectively never changes mid-shift, so
        // only the initial load pays for it. Refetching it on every 15s
        // poll was pure overhead on a mobile connection.
        const [stateRes, catalogRes] = await Promise.all([
          fetch(`/api/orders/state?branch=${branchSlug}`, { cache: 'no-store' }),
          silent ? null : fetch(`/api/orders/catalog?branch=${branchSlug}`, { cache: 'no-store' }),
        ])

        const statePayload = await stateRes.json()
        if (!stateRes.ok) throw new Error(statePayload?.error?.message ?? 'שגיאה בטעינת ההזמנות')

        if (catalogRes) {
          const catalogPayload = await catalogRes.json()
          if (!catalogRes.ok) throw new Error(catalogPayload?.error?.message ?? 'שגיאה בטעינת התפריט')
          setCatalog((catalogPayload.categories as MenuCategory[]) ?? [])
        }

        if (inFlightRef.current === 0) {
          setBoard(statePayload.board as OrdersBoard)
          setError(null)
        }
      } catch (e) {
        // A failed background refresh keeps the last-good board on screen
        // rather than blanking a working register over one dropped poll.
        if (!silent) setError(e instanceof Error ? e.message : 'שגיאה בטעינה')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [branchSlug]
  )

  useEffect(() => {
    void load()
  }, [load])

  const refreshSilently = useCallback(() => void load({ silent: true }), [load])

  useOrdersRealtime(branchSlug, refreshSilently)

  useEffect(() => {
    const interval = window.setInterval(refreshSilently, POLL_MS)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') refreshSilently()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refreshSilently])

  const dispatch = useCallback(
    async (action: OrderAction): Promise<DispatchOutcome> => {
      setBoard((current) => (current ? applyOptimistic(current, action) : current))
      setError(null)
      inFlightRef.current += 1
      try {
        const res = await fetch('/api/orders/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action),
        })
        const payload = await res.json()
        if (!res.ok) {
          const message = payload?.error?.message ?? 'הפעולה נכשלה'
          setError(message)
          return { ok: false, error: message }
        }
        return { ok: true, orderId: payload.orderId, orderNumber: payload.orderNumber, access: payload.access }
      } catch {
        const message = 'הפעולה נכשלה — בדקו את החיבור לרשת'
        setError(message)
        return { ok: false, error: message }
      } finally {
        inFlightRef.current -= 1
        // Reconciles the optimistic guess against the truth — and is what
        // reverts it when the write was rejected. Not awaited: the caller
        // already has the server's authoritative answer, and making it
        // wait for a second round trip is the lag this all exists to
        // remove.
        if (inFlightRef.current === 0) void load({ silent: true })
      }
    },
    [load]
  )

  const value = useMemo<OrdersContextValue>(
    () => ({ branchSlug, board, catalog, loading, error, dispatch, refresh: () => load() }),
    [branchSlug, board, catalog, loading, error, dispatch, load]
  )

  return <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>
}

export function useOrders(): OrdersContextValue {
  const ctx = useContext(OrdersContext)
  if (!ctx) throw new Error('useOrders must be used within an OrdersProvider')
  return ctx
}
