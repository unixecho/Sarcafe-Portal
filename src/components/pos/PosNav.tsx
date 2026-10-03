'use client'

// ============================================================================
// Navigation inside /pos — a tiny view state machine, NOT the Next router.
//
// A cashier flips between Register, a station and Orders hundreds of times a
// shift. A server round trip per flip is exactly what makes people go back to
// paper, so a view change here is a React state change plus a history entry:
//
//   * window.history.pushState / replaceState + a popstate listener (Next 15
//     integrates both calls into its router without refetching anything), and
//   * mirrored to the URL as  ?v=register|station|timeline|orders|home
//                             &p=<point>   (station / timeline)
//                             &add=<order> (register in "add to this order" mode)
//                             &o=<order>   (an order's detail sheet is open)
//     so the browser's Back button works and a reload lands in the same place.
//
//   const { view, go, back, openOrder, closeOrder } = usePosNav()
//   go({ v: 'station', point: id })           // push: Back returns here
//   go({ v: 'orders' }, { replace: true })    // swap in place (what the dock's tabs do)
//   openOrder(id)                             // the detail is a SHEET over the current view
//
// Peer views reached from the dock REPLACE the history entry (they are tabs, and
// Back must not walk through a hundred flips); drill-ins (timeline from a station,
// "add to order" from a detail sheet, an opened order) PUSH, so Back is the way
// out of exactly what you went into.
//
// Where a person LANDS when the URL names no view (a fresh load of /pos):
//   1. this device's remembered post (localStorage 'sarcafe.pos.post.<branch>'),
//      if it still exists; else
//   2. if they are assigned (pointStaff) to exactly ONE point, that station; else
//   3. HOME — "where are you working today?".
// The URL always wins over all three, so a reload never moves you.
//
// IDs read from the URL are untrusted: they must look like a uuid before they are
// used for anything, and an unknown one is handled by the shell (a friendly
// "this station is gone"), never a blank.
//
// Import this from '@/components/pos/PosNav' — NOT from PosApp. PosApp imports
// every screen; a screen importing PosApp back would be an import cycle.
// ============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePos } from './PosProvider'

export type PosView =
  | { v: 'home' }
  | { v: 'register'; addTo?: string }
  | { v: 'station'; point: string }
  | { v: 'timeline'; point: string }
  | { v: 'orders' }

/** What a device remembers as "where this device works". */
export type PostChoice = { kind: 'register' } | { kind: 'orders' } | { kind: 'station'; point: string }

export type PosNav = {
  /** false until the first client render has read the URL; the shell paints a skeleton until then */
  ready: boolean
  view: PosView
  /** the order whose detail sheet is open, or null */
  orderId: string | null
  go: (view: PosView, opts?: { replace?: boolean }) => void
  back: () => void
  openOrder: (id: string) => void
  closeOrder: () => void
  /** this device's remembered post (the landing choice), or null */
  savedPost: PostChoice | null
  savePost: (choice: PostChoice | null) => void
}

type NavState = { view: PosView; orderId: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const POST_KEY = 'sarcafe.pos.post.'
const PARAMS = ['v', 'p', 'add', 'o'] as const

// ---- pure helpers (exported for the screens that need to reason about views) --------------------------------

export function viewKey(view: PosView): string {
  switch (view.v) {
    case 'station':
    case 'timeline':
      return `${view.v}:${view.point}`
    case 'register':
      return `register:${view.addTo ?? ''}`
    default:
      return view.v
  }
}

/** The post a view corresponds to (what "remember this device here" would store), or null for home / timeline. */
export function postOfView(view: PosView): PostChoice | null {
  if (view.v === 'register') return { kind: 'register' }
  if (view.v === 'orders') return { kind: 'orders' }
  if (view.v === 'station' || view.v === 'timeline') return { kind: 'station', point: view.point }
  return null
}

export function viewOfPost(post: PostChoice): PosView {
  if (post.kind === 'register') return { v: 'register' }
  if (post.kind === 'orders') return { v: 'orders' }
  return { v: 'station', point: post.point }
}

function parseUrl(search: string): NavState & { hasView: boolean } {
  const q = new URLSearchParams(search)
  const p = q.get('p')
  const add = q.get('add')
  const o = q.get('o')
  const point = p && UUID.test(p) ? p : null
  const orderId = o && UUID.test(o) ? o : null
  switch (q.get('v')) {
    case 'home':
      return { view: { v: 'home' }, orderId, hasView: true }
    case 'register':
      return { view: add && UUID.test(add) ? { v: 'register', addTo: add } : { v: 'register' }, orderId, hasView: true }
    case 'orders':
      return { view: { v: 'orders' }, orderId, hasView: true }
    case 'station':
      if (point) return { view: { v: 'station', point }, orderId, hasView: true }
      break
    case 'timeline':
      if (point) return { view: { v: 'timeline', point }, orderId, hasView: true }
      break
  }
  return { view: { v: 'home' }, orderId, hasView: false }
}

function urlFor(state: NavState): string {
  const q = new URLSearchParams(window.location.search)
  for (const k of PARAMS) q.delete(k)
  q.set('v', state.view.v)
  if (state.view.v === 'station' || state.view.v === 'timeline') q.set('p', state.view.point)
  if (state.view.v === 'register' && state.view.addTo) q.set('add', state.view.addTo)
  if (state.orderId) q.set('o', state.orderId)
  return `${window.location.pathname}?${q.toString()}`
}

function sameView(a: PosView, b: PosView): boolean {
  return viewKey(a) === viewKey(b)
}

function readPost(branchId: string): PostChoice | null {
  try {
    const raw = window.localStorage.getItem(POST_KEY + branchId)
    if (raw === 'register') return { kind: 'register' }
    if (raw === 'orders') return { kind: 'orders' }
    if (raw?.startsWith('station:')) {
      const point = raw.slice('station:'.length)
      if (UUID.test(point)) return { kind: 'station', point }
    }
  } catch {
    /* private mode */
  }
  return null
}

function writePost(branchId: string, choice: PostChoice | null): void {
  try {
    const key = POST_KEY + branchId
    if (!choice) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, choice.kind === 'station' ? `station:${choice.point}` : choice.kind)
  } catch {
    /* the choice just will not be remembered */
  }
}

type History = { depth: number; sheet: boolean }
function readHistory(): History {
  const pos = (window.history.state as { pos?: Partial<History> } | null)?.pos
  return { depth: typeof pos?.depth === 'number' ? pos.depth : 0, sheet: pos?.sheet === true }
}

// ---- provider ----------------------------------------------------------------------------------------------------

const NavCtx = createContext<PosNav | null>(null)

export function usePosNav(): PosNav {
  const v = useContext(NavCtx)
  if (!v) throw new Error('usePosNav() needs <PosApp> above it.')
  return v
}

export function PosNavProvider({ children }: { children: ReactNode }) {
  const { points, pointStaff, me, branchId } = usePos()
  const [state, setState] = useState<NavState | null>(null)
  const [savedPost, setSavedPost] = useState<PostChoice | null>(null)
  const stateRef = useRef<NavState | null>(null)

  const ctx = useRef({ points, pointStaff, meId: me.id, branchId })
  ctx.current = { points, pointStaff, meId: me.id, branchId }

  /** Where a person lands when the URL does not say. */
  const landing = useCallback((saved: PostChoice | null): PosView => {
    const { points: pts, pointStaff: ps, meId } = ctx.current
    const alive = (id: string) => pts.some((p) => p.id === id)
    if (saved) {
      if (saved.kind !== 'station') return viewOfPost(saved)
      if (alive(saved.point)) return { v: 'station', point: saved.point }
    }
    const mine = Array.from(new Set(ps.filter((x) => x.staff_id === meId && alive(x.point_id)).map((x) => x.point_id)))
    const only = mine.length === 1 ? mine[0] : undefined
    return only ? { v: 'station', point: only } : { v: 'home' }
  }, [])

  const apply = useCallback((next: NavState, mode: 'push' | 'replace', sheet = false) => {
    stateRef.current = next
    setState(next)
    try {
      const depth = readHistory().depth + (mode === 'push' ? 1 : 0)
      const data = { pos: { depth, sheet } }
      const url = urlFor(next)
      if (mode === 'push') window.history.pushState(data, '', url)
      else window.history.replaceState(data, '', url)
    } catch {
      /* a sandboxed frame without history: the app still works, only Back and reload-in-place are lost */
    }
  }, [])

  // First client render: read the URL (or land), and write the resolved view back so a reload stays put.
  useEffect(() => {
    const saved = readPost(ctx.current.branchId)
    setSavedPost(saved)
    const parsed = parseUrl(window.location.search)
    const view = parsed.hasView ? parsed.view : landing(saved)
    apply({ view, orderId: parsed.orderId }, 'replace', readHistory().sheet)

    const onPop = () => {
      const p = parseUrl(window.location.search)
      const next: NavState = { view: p.hasView ? p.view : landing(readPost(ctx.current.branchId)), orderId: p.orderId }
      stateRef.current = next
      setState(next)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = useCallback<PosNav['go']>(
    (view, opts) => {
      const cur = stateRef.current
      if (cur && !cur.orderId && sameView(cur.view, view)) return
      apply({ view, orderId: null }, opts?.replace ? 'replace' : 'push')
    },
    [apply],
  )

  const closeOrder = useCallback(() => {
    const cur = stateRef.current
    if (!cur?.orderId) return
    if (readHistory().sheet) {
      // We pushed an entry when the sheet opened; popping it IS closing it. Close the sheet
      // immediately too, so it does not linger for the length of the history traversal.
      const next = { view: cur.view, orderId: null }
      stateRef.current = next
      setState(next)
      window.history.back()
    } else {
      apply({ view: cur.view, orderId: null }, 'replace')
    }
  }, [apply])

  const openOrder = useCallback(
    (id: string) => {
      const cur = stateRef.current
      if (!cur || cur.orderId === id) return
      // Opening one order from inside another's sheet swaps it; the first open pushes.
      if (cur.orderId) apply({ view: cur.view, orderId: id }, 'replace', true)
      else apply({ view: cur.view, orderId: id }, 'push', true)
    },
    [apply],
  )

  const back = useCallback(() => {
    const cur = stateRef.current
    if (!cur) return
    if (cur.orderId) return closeOrder()
    if (readHistory().depth > 0) {
      window.history.back()
      return
    }
    // Nothing of ours to go back to (a reload, or a link straight into a view): go UP instead.
    if (cur.view.v === 'timeline') apply({ view: { v: 'station', point: cur.view.point }, orderId: null }, 'replace')
    else apply({ view: { v: 'home' }, orderId: null }, 'replace')
  }, [apply, closeOrder])

  const savePost = useCallback((choice: PostChoice | null) => {
    writePost(ctx.current.branchId, choice)
    setSavedPost(choice)
  }, [])

  const value = useMemo<PosNav>(
    () => ({
      ready: state !== null,
      view: state?.view ?? { v: 'home' },
      orderId: state?.orderId ?? null,
      go,
      back,
      openOrder,
      closeOrder,
      savedPost,
      savePost,
    }),
    [state, go, back, openOrder, closeOrder, savedPost, savePost],
  )

  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>
}
