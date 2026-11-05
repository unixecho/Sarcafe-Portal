'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { haptic } from '@/lib/haptics'
import { type Lens } from '@/lib/dashboard/lens'
import Seg from '@/components/glass/Seg'
import { settleGlass } from '@/components/glass/GlassMotion'

// The developer's views in ONE perspective, switched by the glass segmented control at the top: manager · employee · developer ·
// alerts (the same idea as the Ayeka Bar developer dashboard).
//
// The panels are server-rendered by the page and passed in, so switching is INSTANT (nothing is fetched). Only the ACTIVE one is
// mounted, so the manager view's live polling (DashboardLive) runs only while that view is open. The chosen view lives in the URL
// (`?view=`), written with replaceState: a refresh keeps it, a shared link opens on it, and nothing is stored on the device.
// glisse's control is the tablist (its own arrow keys and roles); the panel is labelled by the control.
export default function LensTabs({ initial, lenses, panels, badges = {} }: { initial: Lens; lenses: readonly { id: Lens; icon: string; he: string }[]; panels: Partial<Record<Lens, ReactNode>>; /** a count on a tab (unread alerts) */ badges?: Partial<Record<Lens, number>> }) {
  const [lens, setLens] = useState<Lens>(lenses.some((l) => l.id === initial) ? initial : lenses[lenses.length - 1]!.id)
  // A panel that keeps its own count (the notification centre) says so here, so the tab's badge follows what is read in it.
  const [live, setLive] = useState<Partial<Record<Lens, number>>>({})
  useEffect(() => {
    const onBadge = (event: Event) => {
      const detail = (event as CustomEvent<{ lens?: Lens; count?: number }>).detail
      if (detail?.lens && typeof detail.count === 'number') setLive((current) => ({ ...current, [detail.lens as Lens]: detail.count }))
    }
    window.addEventListener('sarcafe:lens-badge', onBadge)
    return () => window.removeEventListener('sarcafe:lens-badge', onBadge)
  }, [])

  const choose = useCallback((next: string) => {
    if (!lenses.some((l) => l.id === next)) return
    settleGlass()
    setLens(next as Lens)
    haptic('select')
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('view', next)
      window.history.replaceState(null, '', url)
    } catch { /* the view still switches; only the refresh-keeps-it nicety is lost */ }
  }, [lenses])

  const items = lenses.map((l) => {
    const count = live[l.id] ?? badges[l.id] ?? 0
    return { value: l.id, label: <span>{l.he}{count > 0 && <span className="gl-pill gl-pill--tiny" aria-label={`${count} שלא נקראו`} style={{ marginInlineStart: 4 }}>{count}</span>}</span> }
  })
  return (
    <>
      <Seg fill label="תצוגות" value={lens} onChange={choose} items={items} />
      <div key={lens} role="region" id={`lens-panel-${lens}`} aria-label={lenses.find((l) => l.id === lens)?.he} className="lens-panel gl-field" style={{ gap: 14 }}>
        {panels[lens]}
      </div>
    </>
  )
}
