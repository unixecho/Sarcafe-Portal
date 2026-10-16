'use client'

import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { haptic } from '@/lib/haptics'
import { type Lens } from '@/lib/dashboard/lens'

// The developer's three views in ONE perspective, switched by a slider at the top: manager · employee · developer. The same
// control as the Ayeka Bar developer dashboard (components/dashboard/LensTabs.tsx there).
//
// The panels are server-rendered by the page and passed in, so switching is INSTANT (nothing is fetched). Only the ACTIVE one is
// mounted, so the manager view's live polling (DashboardLive) runs only while that view is open, never behind the others. The
// chosen view lives in the URL (`?view=`), written with replaceState: a refresh keeps it, a shared link opens on it, and
// nothing is stored on the device.
//
// It is a proper tablist (arrow keys, Home/End, roving tabindex) because it is the page's main navigation. The row sticks to
// the top of the screen while the view scrolls under it.
export default function LensTabs({ initial, lenses, panels }: { initial: Lens; lenses: readonly { id: Lens; icon: string; he: string }[]; panels: Partial<Record<Lens, ReactNode>> }) {
  const [lens, setLens] = useState<Lens>(lenses.some((l) => l.id === initial) ? initial : lenses[lenses.length - 1]!.id)
  const refs = useRef<Partial<Record<Lens, HTMLButtonElement | null>>>({})

  const choose = useCallback((next: Lens, focus = false) => {
    setLens(next)
    haptic('select')
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('view', next)
      window.history.replaceState(null, '', url)
    } catch { /* the view still switches; only the refresh-keeps-it nicety is lost */ }
    if (focus) refs.current[next]?.focus()
  }, [])

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const at = lenses.findIndex((l) => l.id === lens)
    // The row is RTL, so the first lens sits on the RIGHT: ArrowRight goes to the previous one, ArrowLeft to the next.
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? -1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? 1 : 0
    if (step !== 0) { event.preventDefault(); choose(lenses[(at + step + lenses.length) % lenses.length]!.id, true) }
    else if (event.key === 'Home') { event.preventDefault(); choose(lenses[0]!.id, true) }
    else if (event.key === 'End') { event.preventDefault(); choose(lenses[lenses.length - 1]!.id, true) }
  }

  return (
    <>
      <div role="tablist" aria-label="תצוגות" onKeyDown={onKey} className="lens-tabs">
        {lenses.map((l) => (
          <button
            key={l.id} ref={(el) => { refs.current[l.id] = el }} type="button" role="tab" id={`lens-tab-${l.id}`}
            aria-selected={l.id === lens} aria-controls={`lens-panel-${l.id}`} tabIndex={l.id === lens ? 0 : -1}
            className="lens-tab press" onClick={() => choose(l.id)}
          >
            <span aria-hidden="true">{l.icon}</span>{l.he}
          </button>
        ))}
      </div>
      <div key={lens} role="tabpanel" id={`lens-panel-${lens}`} aria-labelledby={`lens-tab-${lens}`} tabIndex={-1} className="lens-panel rise">
        {panels[lens]}
      </div>
    </>
  )
}
