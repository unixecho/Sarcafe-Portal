'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Re-reads the server page once a minute while the app is on screen, and again the moment it comes back to the front, so "who is on
// shift" is never a stale snapshot of when the app was opened. It never refreshes a hidden page (no battery or data spent in a pocket).
export default function OnShiftRefresher() {
  const router = useRouter()
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') router.refresh() }
    const id = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [router])
  return null
}
