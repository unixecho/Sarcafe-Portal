'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { reduce, type CartAction } from '@/lib/cart/store'
import { loadCart, saveCart, tutorialSeen, markTutorialSeen } from '@/lib/cart/storage'
import { EMPTY_CART, type Cart } from '@/lib/cart/types'

type CartContextValue = {
  cart: Cart
  dispatch: (action: CartAction) => void
  /** Total qty across every line — what the FAB's badge shows. */
  count: number
  /** Has the FAB ever been shown on this device for this branch's cart? */
  summoned: boolean
  showTutorial: boolean
  dismissTutorial: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

const SAVE_DEBOUNCE_MS = 200

/** One provider per branch (MenuView mounts it keyed by branchSlug), so
 *  switching branches on the public menu never carries one truck's items
 *  into the other's list — matches localStorage's own per-branch key. */
export default function CartProvider({ branchSlug, children }: { branchSlug: string; children: ReactNode }) {
  const [cart, setCart] = useState<Cart>(EMPTY_CART)
  const [summoned, setSummoned] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const loadedRef = useRef(false)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    const { cart: loaded, summoned: wasSummoned } = loadCart(branchSlug)
    setCart(loaded)
    setSummoned(wasSummoned)
    loadedRef.current = true
  }, [branchSlug])

  useEffect(() => {
    if (!loadedRef.current) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => saveCart(branchSlug, cart, summoned), SAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [branchSlug, cart, summoned])

  const dispatch = useCallback((action: CartAction) => {
    setCart((prev) => {
      const next = reduce(prev, action)
      // reduce() returns the SAME reference when an 'add' was a genuine
      // no-op (MAX_LINES reached) — only a real change summons the FAB
      // and, the first time ever, shows the tutorial.
      if (action.type === 'add' && next !== prev) {
        setSummoned(true)
        if (!tutorialSeen()) setShowTutorial(true)
      }
      return next
    })
  }, [])

  const dismissTutorial = useCallback(() => {
    markTutorialSeen()
    setShowTutorial(false)
  }, [])

  const count = useMemo(() => cart.lines.reduce((sum, l) => sum + l.qty, 0), [cart.lines])

  const value = useMemo<CartContextValue>(
    () => ({ cart, dispatch, count, summoned, showTutorial, dismissTutorial }),
    [cart, dispatch, count, summoned, showTutorial, dismissTutorial]
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within a CartProvider')
  return ctx
}
