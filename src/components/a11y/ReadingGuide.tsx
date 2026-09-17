'use client'

import { useEffect, useRef } from 'react'
import { useA11y } from './A11yProvider'

const HALF_HEIGHT = 20

/** A horizontal band that tracks the pointer, for reading a long line of
 * text without losing your place. Positioned via direct style writes on
 * every pointermove rather than React state — this needs to feel
 * perfectly attached to the cursor, and a state-driven re-render per
 * frame would add exactly the kind of lag that defeats the point. Outside
 * #a11y-scope (mounted alongside the launcher in A11yWidget), so none of
 * the scope's own filters (grayscale, invert) ever wash it out. */
export default function ReadingGuide() {
  const { prefs } = useA11y()
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!prefs.readingGuide) return
    function onMove(e: PointerEvent) {
      const bar = barRef.current
      if (bar) bar.style.transform = `translateY(${e.clientY - HALF_HEIGHT}px)`
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [prefs.readingGuide])

  if (!prefs.readingGuide) return null
  return <div ref={barRef} className="a11y-reading-guide" aria-hidden="true" />
}
