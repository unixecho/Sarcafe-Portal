'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useOrdersRealtime } from '@/lib/orders/useOrdersRealtime'
import type { OrderAction } from '@/lib/orders/actions'
import type { OrdersBoard } from '@/lib/orders/types'
import type { MenuCategory } from '@/lib/menu/types'

const POLL_MS = 15_000

type DispatchOutcome = { ok: true; orderId?: string; orderNumber?: number } | { ok: false; error: string }

type OrdersContextValue = {
  branchSlug: string
  board: OrdersBoard | null
  catalog: MenuCategory[]
  loading: boolean
  error: string | null
  /** Sends an action, awaits the server's authoritative result, then
   *  replaces state with a fresh read — same no-optimistic-apply shape
   *  lib/shifts/actions.ts documents (and for the same reason: one place
   *  that knows what an action actually does, no client-side mirror to
   *  keep in sync). */
  dispatch: (action: OrderAction) => Promise<DispatchOutcome>
  refresh: () => Promise<void>
}

const OrdersContext = createContext<OrdersContextValue | null>(null)

export default function OrdersProvider({ branchSlug, children }: { branchSlug: string; children: ReactNode }) {
  const [board, setBoard] = useState<OrdersBoard | null>(null)
  const [catalog, setCatalog] = useState<MenuCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!branchSlug) return
    setLoading(true)
    setError(null)
    try {
      const [stateRes, catalogRes] = await Promise.all([
        fetch(`/api/orders/state?branch=${branchSlug}`, { cache: 'no-store' }),
        fetch(`/api/orders/catalog?branch=${branchSlug}`, { cache: 'no-store' }),
      ])
      const statePayload = await stateRes.json()
      if (!stateRes.ok) throw new Error(statePayload?.error?.message ?? 'שגיאה בטעינת ההזמנות')
      const catalogPayload = await catalogRes.json()
      if (!catalogRes.ok) throw new Error(catalogPayload?.error?.message ?? 'שגיאה בטעינת התפריט')
      setBoard(statePayload.board as OrdersBoard)
      setCatalog((catalogPayload.categories as MenuCategory[]) ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינה')
    } finally {
      setLoading(false)
    }
  }, [branchSlug])

  useEffect(() => {
    void load()
  }, [load])

  useOrdersRealtime(branchSlug, load)

  useEffect(() => {
    const interval = window.setInterval(() => void load(), POLL_MS)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [load])

  const dispatch = useCallback(
    async (action: OrderAction): Promise<DispatchOutcome> => {
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
        await load()
        return { ok: true, orderId: payload.orderId, orderNumber: payload.orderNumber }
      } catch {
        const message = 'הפעולה נכשלה — בדקו את החיבור לרשת'
        setError(message)
        return { ok: false, error: message }
      }
    },
    [load]
  )

  const value = useMemo<OrdersContextValue>(
    () => ({ branchSlug, board, catalog, loading, error, dispatch, refresh: load }),
    [branchSlug, board, catalog, loading, error, dispatch, load]
  )

  return <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>
}

export function useOrders(): OrdersContextValue {
  const ctx = useContext(OrdersContext)
  if (!ctx) throw new Error('useOrders must be used within an OrdersProvider')
  return ctx
}
