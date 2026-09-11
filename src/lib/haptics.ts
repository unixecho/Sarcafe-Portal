// Best-effort haptic feedback, ported near-verbatim from AyekaBar. Never
// throws, never blocks. Two independent backends tried in order:
// navigator.vibrate() (Android/Chrome), then an iOS trick (flipping a
// hidden `<input type="checkbox" switch>` has produced a haptic tap on iOS
// Safari since 17.4, which has no Vibration API at all).
//
// Doctrine: haptics are seasoning, never the signal — every caller must
// remain fully correct/legible with haptics silently doing nothing (which
// is the reality on desktop, disabled vibration, and most non-iOS-17.4+
// browsers).

type HapticPattern = 'tick' | 'select' | 'impact'

const DURATIONS: Record<HapticPattern, number> = { tick: 6, select: 12, impact: 22 }
const MIN_GAP_MS = 24

let vibrateWorks: boolean | null = null
let lastFire = 0
let iosCheckbox: HTMLInputElement | null = null

function getIosCheckbox(): HTMLInputElement {
  if (!iosCheckbox) {
    iosCheckbox = document.createElement('input')
    iosCheckbox.type = 'checkbox'
    // @ts-expect-error -- non-standard `switch` attribute, iOS Safari only.
    iosCheckbox.switch = true
    iosCheckbox.setAttribute('aria-hidden', 'true')
    iosCheckbox.tabIndex = -1
    Object.assign(iosCheckbox.style, {
      position: 'fixed',
      opacity: '0',
      pointerEvents: 'none',
      // Never display:none — an unrendered control gets no OS feedback.
      width: '1px',
      height: '1px',
    })
    document.body.appendChild(iosCheckbox)
  }
  return iosCheckbox
}

export function haptic(pattern: HapticPattern = 'tick') {
  if (typeof window === 'undefined') return

  const now = performance.now()
  if (now - lastFire < MIN_GAP_MS) return
  lastFire = now

  const ms = DURATIONS[pattern]

  if (vibrateWorks !== false && 'vibrate' in navigator) {
    try {
      const ok = navigator.vibrate(ms)
      if (vibrateWorks === null) vibrateWorks = ok
      if (ok) return
    } catch {
      vibrateWorks = false
    }
  }

  // iOS fallback. Clicking a checkbox moves keyboard focus to it — capture
  // and restore whatever had focus so a haptic call never silently steals
  // it (this is the one platform this path exists for, so it fires on
  // every call there).
  try {
    const checkbox = getIosCheckbox()
    const previouslyFocused = document.activeElement as HTMLElement | null
    checkbox.click()
    if (previouslyFocused && previouslyFocused !== checkbox) {
      previouslyFocused.focus({ preventScroll: true })
    }
  } catch {
    // No-op — desktop browsers with no vibration API and no iOS quirk
    // simply get no haptic feedback, which is fine.
  }
}
