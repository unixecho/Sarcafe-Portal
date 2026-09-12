// iOS-style page-push navigation, ported near-verbatim from AyekaBar — this
// file has zero app-specific logic. Pairs with components/PageTransitions
// and app/template.tsx.
//
// Browsers don't expose "was this a forward or back navigation," so a small
// sessionStorage stack tracks the path history ourselves to infer direction
// for `popstate`-less (link click) navigations.

const NAV_STACK_KEY = 'sarcafe:navStack'
const NAV_STACK_CAP = 25
const COMMIT_TIMEOUT_MS = 700
const FALLBACK_ANIM_MS = 380

export type NavDirection = 'forward' | 'back'

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function readStack(): string[] {
  try {
    const raw = window.sessionStorage.getItem(NAV_STACK_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function writeStack(stack: string[]) {
  try {
    window.sessionStorage.setItem(NAV_STACK_KEY, JSON.stringify(stack.slice(-NAV_STACK_CAP)))
  } catch {
    // Private browsing / quota — non-fatal, direction just falls back to
    // "forward" for this navigation.
  }
}

/** Infers direction for a same-origin link click to `path`. */
export function directionFor(path: string): NavDirection {
  const stack = readStack()
  const idx = stack.lastIndexOf(path)
  // If `path` is exactly the entry below the current top, this reads as
  // "back" (revisiting the previous page); anything else is "forward."
  return idx !== -1 && idx === stack.length - 2 ? 'back' : 'forward'
}

/** Call after a navigation has actually committed (new pathname rendered)
 * to keep the inferred-direction stack in sync. */
export function recordNavigation(path: string) {
  const stack = readStack()
  if (stack[stack.length - 1] === path) return
  writeStack([...stack, path])
}

let settleResolver: (() => void) | null = null

/** Called once the newly-navigated route has actually painted, to let the
 * browser un-freeze the outgoing screenshot. Safe to call even if no
 * transition is in flight. */
export function settleNavigation() {
  document.documentElement.removeAttribute('data-vt')
  if (settleResolver) {
    settleResolver()
    settleResolver = null
  }
}

/**
 * Drives a same-document push navigation through the View Transition API
 * when available, with a plain CSS-entrance fallback otherwise (older
 * browsers, or prefers-reduced-motion). `commit` performs the actual
 * navigation (e.g. `router.push(path)`).
 */
export function navigateWithTransition(path: string, direction: NavDirection, commit: () => void) {
  document.documentElement.dataset.nav = direction

  const supportsViewTransitions =
    typeof document !== 'undefined' && 'startViewTransition' in document && !prefersReducedMotion()

  if (!supportsViewTransitions) {
    commit()
    window.setTimeout(() => document.documentElement.removeAttribute('data-vt'), FALLBACK_ANIM_MS)
    return
  }

  document.documentElement.dataset.vt = 'running'

  document.startViewTransition(() => {
    return new Promise<void>((resolve) => {
      settleResolver = resolve
      commit()
      // Backstop: if the new route never calls settleNavigation() (e.g. an
      // error boundary swallowed the render), don't leave the transition
      // permanently "running."
      window.setTimeout(() => {
        if (settleResolver === resolve) settleNavigation()
      }, COMMIT_TIMEOUT_MS)
    })
  })
}

/**
 * Companion to navigateWithTransition() for navigation this app doesn't
 * itself drive — the browser back/forward button, an edge-swipe, a
 * hardware back gesture. Next.js's router still re-renders the page via
 * its own History-API-driven update, so there's no `commit()` step here:
 * this only needs to start the View Transition BEFORE that re-render
 * paints, so the outgoing screenshot is captured while the old page is
 * still on screen. Call this synchronously from the `popstate` handler.
 *
 * Without this, back navigation only gets the weaker CSS `.page-enter`
 * fallback (see app/template.tsx) — link-click forward navigation gets the
 * full directional slide via navigateWithTransition, but popstate never
 * called it, so back never looked the same as forward.
 */
export function beginBackTransition() {
  document.documentElement.dataset.nav = 'back'

  const supportsViewTransitions =
    typeof document !== 'undefined' && 'startViewTransition' in document && !prefersReducedMotion()
  if (!supportsViewTransitions) return

  document.documentElement.dataset.vt = 'running'

  document.startViewTransition(() => {
    return new Promise<void>((resolve) => {
      settleResolver = resolve
      // Backstop: same reasoning as navigateWithTransition — if the
      // post-popstate render never calls settleNavigation(), don't leave
      // the transition frozen forever.
      window.setTimeout(() => {
        if (settleResolver === resolve) settleNavigation()
      }, COMMIT_TIMEOUT_MS)
    })
  })
}
