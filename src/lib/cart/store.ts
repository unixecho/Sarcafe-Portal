// One action type, one pure reducer — no React, no DOM, no storage. Same
// discipline AyekaBar's lib/cart/store.ts and lib/shifts/store.ts both use:
// every mutation the UI can make is representable as one of these, so
// there's exactly one place that decides what an "add" or a "decrement"
// actually does.

import { randomId } from '@/lib/menu/id'
import { MAX_LINES, MAX_QTY, type Cart, type CartLine } from './types'

export type CartAction =
  | { type: 'add'; line: Omit<CartLine, 'id' | 'addedAt' | 'qty'>; qty?: number }
  | { type: 'increment'; id: string }
  | { type: 'decrement'; id: string }
  | { type: 'setNote'; id: string; note: string }
  | { type: 'remove'; id: string }
  | { type: 'clear' }

/** Adding the same item+type again merges onto the existing line (bumps
 *  qty) instead of stacking a duplicate row. */
function findMergeTarget(cart: Cart, itemUid: string, typeUid: string | null): CartLine | undefined {
  return cart.lines.find((l) => l.itemUid === itemUid && l.typeUid === typeUid)
}

export function reduce(cart: Cart, action: CartAction): Cart {
  switch (action.type) {
    case 'add': {
      const qty = Math.min(MAX_QTY, Math.max(1, Math.floor(action.qty ?? 1)))
      const existing = findMergeTarget(cart, action.line.itemUid, action.line.typeUid)
      if (existing) {
        return { lines: cart.lines.map((l) => (l.id === existing.id ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l)) }
      }
      if (cart.lines.length >= MAX_LINES) return cart
      const line: CartLine = { ...action.line, id: randomId('cl'), addedAt: Date.now(), qty }
      return { lines: [...cart.lines, line] }
    }

    case 'increment':
      return { lines: cart.lines.map((l) => (l.id === action.id ? { ...l, qty: Math.min(MAX_QTY, l.qty + 1) } : l)) }

    case 'decrement': {
      const target = cart.lines.find((l) => l.id === action.id)
      if (!target) return cart
      // "−" on the last unit removes the line rather than leaving a
      // qty-0 row on screen.
      if (target.qty <= 1) return { lines: cart.lines.filter((l) => l.id !== action.id) }
      return { lines: cart.lines.map((l) => (l.id === action.id ? { ...l, qty: l.qty - 1 } : l)) }
    }

    case 'setNote':
      return { lines: cart.lines.map((l) => (l.id === action.id ? { ...l, note: action.note.trim() || undefined } : l)) }

    case 'remove':
      return { lines: cart.lines.filter((l) => l.id !== action.id) }

    case 'clear':
      return { lines: [] }

    default:
      return cart
  }
}
