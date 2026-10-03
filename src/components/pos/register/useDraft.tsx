'use client'

// The cart draft, persisted per branch + person (+ an optional scope for "add to order").
//
// WHY localStorage and not component state: PosApp mounts exactly one view, so a flip to
// Orders and back unmounts the register. A half-typed order that evaporated on a flip, a
// refresh or a crashed tab is the failure that sends a cashier back to paper.
//
// Every storage access is in try/catch (private mode, full quota). The first render is
// always an empty draft and the stored one is loaded in an effect, so server and client
// markup agree; `hydrated` tells the screen when it may decide "the draft is empty, open
// the order-start sheet".

import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from 'react'
import {
  cartReducer, draftStorageKey, emptyDraft, isBlank, sanitizeDraft, type CartAction, type Draft,
} from '@/lib/pos/cart'

const SAVE_DEBOUNCE_MS = 200

function hasContent(d: Draft): boolean {
  return !isBlank(d) || d.customerPhone !== '' || d.orderNote !== '' || d.receiptRef !== '' || d.slipTotal !== ''
}

export function readDraft(key: string): Draft {
  try {
    const raw = window.localStorage.getItem(key)
    return sanitizeDraft(raw ? JSON.parse(raw) : null)
  } catch {
    return sanitizeDraft(null)
  }
}

export function writeDraft(key: string, draft: Draft): void {
  try {
    if (hasContent(draft)) window.localStorage.setItem(key, JSON.stringify(draft))
    else window.localStorage.removeItem(key)
  } catch {
    /* quota / private mode: the draft just will not survive a reload */
  }
}

export function useDraft(
  branchId: string,
  staffId: string,
  scope?: string,
): { draft: Draft; dispatch: Dispatch<CartAction>; hydrated: boolean; storageKey: string } {
  const storageKey = draftStorageKey(branchId, staffId, scope)
  const [draft, dispatch] = useReducer(cartReducer, undefined, () => emptyDraft(Date.now()))
  const [hydratedKey, setHydratedKey] = useState<string | null>(null)

  // Load once per key. The stored draft is only trusted after sanitizeDraft().
  useEffect(() => {
    dispatch({ type: 'load', draft: readDraft(storageKey) })
    setHydratedKey(storageKey)
  }, [storageKey])

  const latest = useRef({ draft, storageKey, ready: false })
  latest.current = { draft, storageKey, ready: hydratedKey === storageKey }

  // Debounced save. Never before hydration: that would overwrite the stored draft with the empty one.
  useEffect(() => {
    if (hydratedKey !== storageKey) return
    const id = window.setTimeout(() => writeDraft(storageKey, draft), SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [draft, hydratedKey, storageKey])

  // Flush on the way out so the last tap before a flip or a closing tab is not lost to the debounce.
  const flush = useCallback(() => {
    const l = latest.current
    if (l.ready) writeDraft(l.storageKey, l.draft)
  }, [])
  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  return { draft, dispatch, hydrated: hydratedKey === storageKey, storageKey }
}
