'use client'

import { useState, type ReactNode } from 'react'

// A template.tsx (not layout.tsx) on purpose: Next.js remounts a template
// on every navigation, where a layout persists — this is exactly what lets
// us read data-vt exactly once per page instance. Ported from AyekaBar.
//
// When a navigation went through the JS-driven push (PageTransitions), the
// View Transition API is already animating a screenshot of the incoming
// page, so this instance's own CSS entrance (and its children's .rise
// stagger) must be suppressed — but only for this mounted instance, read
// once at construction time, never toggled live. Toggling animation-name
// between 'none' and a value restarts a CSS animation from frame zero per
// spec, which is the bug this design avoids.
export default function Template({ children }: { children: ReactNode }) {
  const [pushed] = useState(() => typeof document !== 'undefined' && document.documentElement.dataset.vt === 'running')

  return <div className={pushed ? 'page-enter page-enter--pushed' : 'page-enter'}>{children}</div>
}
