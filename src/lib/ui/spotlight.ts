// "Go there and show me" (owner, 2026-10-17: a redirect must scroll to what it is about and highlight it). Browser-only. Finds the element
// (waiting a moment for a tab or a page to render it), scrolls it into view (smoothly unless less motion is asked for), moves focus to it
// when it can take focus, and marks it with a ring that breathes (`spot-target`, app.css). The mark goes when the person touches it or types,
// or after a while. Prefer NOT redirecting at all: a field that needs filling opens a small dialog (FieldSheet) right where the person is.

const SPOT = 'spot-target'
const FIND_FOR_MS = 900
const MARK_MS = 20_000

export type SpotOptions = { focus?: boolean; ms?: number }

function resolve(target: string | Element): Element | null {
  return typeof target === 'string' ? document.getElementById(target) : target
}

export function spotlight(target: string | Element | null, options: SpotOptions = {}): void {
  if (typeof document === 'undefined' || !target) return
  const less = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const started = Date.now()
  const attempt = () => {
    const el = resolve(target)
    if (!el) {
      if (Date.now() - started < FIND_FOR_MS) window.setTimeout(attempt, 50)
      return
    }
    el.scrollIntoView({ behavior: less ? 'auto' : 'smooth', block: 'center' })
    // Let the scroll arrive before the ring starts, so the eye follows the page and then sees where to look.
    window.setTimeout(() => {
      el.classList.add(SPOT)
      if (options.focus !== false && el instanceof HTMLElement) el.focus({ preventScroll: true })
    }, less ? 0 : 420)
    let timer = 0
    const stop = () => {
      el.classList.remove(SPOT)
      el.removeEventListener('pointerdown', stop)
      el.removeEventListener('input', stop)
      window.clearTimeout(timer)
    }
    el.addEventListener('pointerdown', stop)
    el.addEventListener('input', stop)
    timer = window.setTimeout(stop, options.ms ?? MARK_MS)
  }
  attempt()
}
