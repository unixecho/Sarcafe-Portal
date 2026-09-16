// The customer's own "show staff my order" list, on the customer's own
// phone — client-side only, by design (confirmed with the owner): nothing
// here is ever submitted as a real order, there's no OTP/identity, no
// diner-splitting. Ported in spirit from AyekaBar's lib/cart/types.ts (the
// 3-layer split: types/store/storage), stripped of everything that only
// existed for AyekaBar's seated multi-diner ordering flow.

import type { Localized } from '@/lib/menu/types'

export interface CartLine {
  id: string
  /** The menu item's stable uid (ensureUids() in the editor). */
  itemUid: string
  /** Which MenuItemType was chosen, if the item has types (see
   *  lib/menu/types.ts) — null for a plain item with no types. */
  typeUid: string | null
  /** Snapshot at add-time — the menu can be republished mid-visit; the
   *  customer's list must not silently rename itself. */
  name: Localized
  typeLabel: Localized | null
  /** What the menu showed, verbatim — this cart never needs a computed
   *  total (it's shown to staff, who ring it up themselves), so there's no
   *  reason to parse it into a number the way a real order would. */
  priceText: string
  qty: number
  note?: string
  categoryId: string
  categoryTitle: Localized
  /** Epoch ms — orders the sheet, newest first. */
  addedAt: number
}

export interface Cart {
  lines: CartLine[]
}

export const EMPTY_CART: Cart = { lines: [] }

export const MAX_LINES = 60
export const MAX_QTY = 30
export const MAX_NOTE_LEN = 120

/** A cart is a single visit — long enough to cover a slow order, short
 *  enough that tomorrow's customer doesn't reopen the menu to last week's
 *  list. Checked on read; an expired cart is dropped, not shown and then
 *  cleared. */
export const CART_TTL_MS = 8 * 60 * 60 * 1000

/** Per-branch, unlike AyekaBar's single shared key — Sarcafe has two
 *  locations, and a customer switching branches on the public menu should
 *  never see the other truck's items in their list. Versioned in the key
 *  itself, not the payload, so an incompatible future shape just doesn't
 *  find an old cart — no migration code, no half-parsed state. */
export function cartStorageKey(branchSlug: string): string {
  return `sarcafe.cart.v1.${branchSlug}`
}

export const CART_TUTORIAL_KEY = 'sarcafe.cart.tutorial.v1'

export interface StoredCart {
  savedAt: number
  cart: Cart
  /** Has the cart button ever been summoned? Persisted so a returning
   *  customer reloading a page with a cart already in it doesn't see the
   *  FAB pop into existence a second time. */
  summoned: boolean
}
