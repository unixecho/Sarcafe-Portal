'use client'

import { useEffect, useRef, useState } from 'react'

// Must match .sheet-scrim--closing's animation-duration in globals.css.
const CLOSE_MS = 220

/**
 * Gives every sheet/dialog (SheetShell, ConfirmSheet, PromptSheet) a real
 * closing animation instead of vanishing the instant `open` flips to
 * false. The caller's own close logic is unchanged — this only delays the
 * actual unmount by CLOSE_MS so the CSS reverse animation
 * (.sheet-scrim--closing in globals.css) gets to play first, matching the
 * entrance it already has. The literal "opens like a book, closes the
 * same way" ask.
 */
export function useSheetExit(open: boolean) {
  const [rendered, setRendered] = useState(open)
  const [closing, setClosing] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (open) {
      window.clearTimeout(timer.current)
      setClosing(false)
      setRendered(true)
      return
    }
    if (!rendered) return
    setClosing(true)
    timer.current = window.setTimeout(() => {
      setRendered(false)
      setClosing(false)
    }, CLOSE_MS)
    return () => window.clearTimeout(timer.current)
    // rendered intentionally excluded — this effect only reacts to `open`
    // flipping; re-running it because `rendered` changed (which this same
    // effect just set) would clear the timer it just started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return { rendered, closing }
}
