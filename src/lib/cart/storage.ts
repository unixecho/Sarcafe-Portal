// localStorage persistence for the cart, and the sanitizer that guards it.
// Ported in spirit from AyekaBar's lib/cart/storage.ts: localStorage is the
// DEVICE's memory, not this app's — it can hold a half-written value from a
// tab killed mid-write, a stale shape from a build three deploys ago, or a
// string someone typed into devtools. Parse defensively, keep what's
// well-formed, drop the rest, never let a bad byte reach React.

import {
  CART_TTL_MS,
  CART_TUTORIAL_KEY,
  EMPTY_CART,
  MAX_LINES,
  MAX_NOTE_LEN,
  MAX_QTY,
  cartStorageKey,
  type Cart,
  type CartLine,
  type StoredCart,
} from './types'

const LANG_KEYS = ['he', 'en', 'ar'] as const

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.replace(/\s+/g, ' ').trim().slice(0, max)
  return t || undefined
}

/** Keeps only the three known language keys, each a bounded string — a
 *  Localized value is not a free-form bag. */
function localized(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof v !== 'object' || v === null) return out
  const src = v as Record<string, unknown>
  for (const k of LANG_KEYS) {
    const s = str(src[k], 200)
    if (s) out[k] = s
  }
  return out
}

/** Turns anything at all into a valid Cart. Never throws, never returns a
 *  line the reducer or the UI could choke on. */
export function sanitizeCart(input: unknown): Cart {
  if (typeof input !== 'object' || input === null) return EMPTY_CART
  const src = input as Record<string, unknown>

  const lines: CartLine[] = []
  const seen = new Set<string>()
  if (Array.isArray(src.lines)) {
    for (const raw of src.lines) {
      if (lines.length >= MAX_LINES) break
      if (typeof raw !== 'object' || raw === null) continue
      const l = raw as Record<string, unknown>

      const id = str(l.id, 64)
      const itemUid = str(l.itemUid, 128)
      if (!id || !itemUid || seen.has(id)) continue

      const qtyRaw = Math.floor(Number(l.qty))
      if (!Number.isFinite(qtyRaw) || qtyRaw < 1) continue

      const addedAtRaw = Number(l.addedAt)
      const note = str(l.note, MAX_NOTE_LEN)
      const typeLabelValue = l.typeLabel && typeof l.typeLabel === 'object' ? localized(l.typeLabel) : null

      seen.add(id)
      lines.push({
        id,
        itemUid,
        typeUid: str(l.typeUid, 128) ?? null,
        name: localized(l.name),
        typeLabel: typeLabelValue && Object.keys(typeLabelValue).length ? typeLabelValue : null,
        priceText: str(l.priceText, 40) ?? '',
        qty: Math.min(MAX_QTY, qtyRaw),
        categoryId: str(l.categoryId, 64) ?? '',
        categoryTitle: localized(l.categoryTitle),
        addedAt: Number.isFinite(addedAtRaw) && addedAtRaw > 0 ? addedAtRaw : 0,
        ...(note ? { note } : {}),
      })
    }
  }

  return { lines }
}

/** Returns nulls for "nothing usable here" (expired cart, a private tab
 *  that throws on access, a corrupt payload) — the caller starts empty
 *  either way, and none of this is worth showing a customer as an error. */
export function loadCart(branchSlug: string): { cart: Cart; summoned: boolean } {
  const empty = { cart: EMPTY_CART, summoned: false }
  if (typeof window === 'undefined') return empty
  try {
    const raw = window.localStorage.getItem(cartStorageKey(branchSlug))
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<StoredCart> | null
    if (!parsed || typeof parsed !== 'object') return empty

    const savedAt = Number(parsed.savedAt)
    // A savedAt in the future (a device clock that was wrong and got
    // fixed) is treated as stale, not valid forever.
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > CART_TTL_MS || savedAt > Date.now() + 60_000) {
      clearCart(branchSlug)
      return empty
    }

    const cart = sanitizeCart(parsed.cart)
    return { cart, summoned: parsed.summoned === true && cart.lines.length > 0 }
  } catch {
    return empty
  }
}

export function saveCart(branchSlug: string, cart: Cart, summoned: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (cart.lines.length === 0) {
      // Don't leave an empty husk behind that would keep resurrecting a
      // "summoned" flag for a cart with nothing in it.
      window.localStorage.removeItem(cartStorageKey(branchSlug))
      return
    }
    const payload: StoredCart = { savedAt: Date.now(), cart, summoned }
    window.localStorage.setItem(cartStorageKey(branchSlug), JSON.stringify(payload))
  } catch {
    // Quota exceeded, private mode, storage disabled — the cart still
    // works for this page view, it just won't survive a reload.
  }
}

export function clearCart(branchSlug: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(cartStorageKey(branchSlug))
  } catch {
    /* see saveCart */
  }
}

export function tutorialSeen(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(CART_TUTORIAL_KEY) === '1'
  } catch {
    // Cannot tell — assume seen. A browser that refuses storage would
    // otherwise show the tutorial on every single add.
    return true
  }
}

export function markTutorialSeen(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CART_TUTORIAL_KEY, '1')
  } catch {
    /* Nothing to do and nothing worth saying. */
  }
}
