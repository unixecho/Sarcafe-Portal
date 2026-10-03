'use client'

// Keep the screen awake while the staff app is in use (blueprint §10.6): a tablet that dims
// mid-service is a cook who stops seeing the queue. Ayeka's only wake lock, generalised.
//
// The browser RELEASES a screen wake lock by itself whenever the page is hidden (tab switch,
// screen lock), and a request made while hidden is refused — so "acquire once" would leave a
// tablet that was locked and unlocked dimming normally for the rest of the shift. This re-acquires
// on every return to visible, and releases on cleanup. Every failure (unsupported browser, an
// insecure origin, low battery, the user's power settings) is swallowed: a dimming screen is a
// nuisance, never a reason to break a screen that is working.

import { useEffect } from 'react'

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let cancelled = false
    let requesting = false
    let sentinel: WakeLockSentinel | null = null

    const acquire = async () => {
      // `requesting` stops two visibilitychange events in quick succession from taking two locks.
      if (cancelled || requesting || document.visibilityState !== 'visible') return
      if (sentinel && !sentinel.released) return
      requesting = true
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          // Unmounted while the request was in flight: do not leak a lock nobody owns.
          void lock.release().catch(() => {})
          return
        }
        sentinel = lock
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null
        })
      } catch {
        /* unsupported, refused, or hidden again by the time it ran */
      } finally {
        requesting = false
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    document.addEventListener('visibilitychange', onVisible)
    void acquire()

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      const held = sentinel
      sentinel = null
      if (held) void held.release().catch(() => {})
    }
  }, [active])
}
