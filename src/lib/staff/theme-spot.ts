// "Take me there": scrolls the home screen down to the "מראה האפליקציה" row and marks it so the person knows what to tap (a pulsing ring and a
// "לחצו כאן" pill, class `app-row--spot`, drawn by app.css). Browser-only. The mark goes away when the row is tapped, or after a while; the
// small "חדש" badge on the row stays until a look is chosen. Less motion asked for: no smooth scroll and no pulse (the pill still shows).

import { THEME_ROW_ID } from '@/lib/staff/theme'

const SPOT_CLASS = 'app-row--spot'
const SPOT_MS = 30_000

export function spotlightThemeRow(): void {
  if (typeof document === 'undefined') return
  const row = document.getElementById(THEME_ROW_ID)
  if (!row) return
  const less = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  row.scrollIntoView({ behavior: less ? 'auto' : 'smooth', block: 'center' })
  // Let the scroll arrive before the ring starts, so the eye follows the page down and then sees where to tap.
  window.setTimeout(() => {
    row.classList.add(SPOT_CLASS)
    // A keyboard or screen-reader user lands on the row itself.
    row.focus({ preventScroll: true })
  }, less ? 0 : 550)
  let timer = 0
  const stop = () => {
    row.classList.remove(SPOT_CLASS)
    row.removeEventListener('click', stop)
    row.removeEventListener('pointerdown', stop)
    window.clearTimeout(timer)
  }
  row.addEventListener('click', stop)
  row.addEventListener('pointerdown', stop)
  timer = window.setTimeout(stop, SPOT_MS)
}
