'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import GlassDock from './GlassDock'
import { onDockRoot, type DockPlan } from '@/lib/nav/dock'
import 'glisse/styles.css'
import './glass.css'

// Draws the dock from the /owner and /staff layouts (src/lib/nav/dock.ts decides who gets which, and where). Because it lives in the
// layout, Next keeps this same element while the person moves between the tabs: the bar never disappears or re-draws between pages.
// The spacer gives the older pages room at the end so their last row is not under the bar (glass pages have their own room).
// html[data-dock] lets bars that live at the bottom of a page move above it (glass.css).
export default function DockHost({ plan }: { plan: DockPlan | null }) {
  const pathname = usePathname()
  const shown = !!plan && onDockRoot(plan, pathname)
  useEffect(() => {
    if (!shown) return
    document.documentElement.dataset.dock = '1'
    return () => { delete document.documentElement.dataset.dock }
  }, [shown])
  if (!shown) return null
  return (
    <>
      <div className="gl-dock-spacer" aria-hidden="true" />
      <GlassDock kind={plan.kind} home={plan.home} />
    </>
  )
}
