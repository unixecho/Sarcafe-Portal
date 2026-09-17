'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_A11Y_PREFS, type A11yPrefs } from '@/lib/a11y/types'
import { loadPrefs, savePrefs } from '@/lib/a11y/storage'
import { applyPrefs } from '@/lib/a11y/apply'

type A11yContextValue = {
  prefs: A11yPrefs
  setPrefs: (patch: Partial<A11yPrefs>) => void
  reset: () => void
}

const A11yContext = createContext<A11yContextValue | null>(null)
const SCOPE_ID = 'a11y-scope'

/** Holds the preferences and imperatively classes #a11y-scope — it does
 *  NOT need to wrap the app's own JSX tree (unlike a typical provider) to
 *  do that, since it targets the scope element by id rather than through
 *  React context consumption. Mounted once in layout.tsx, as a sibling of
 *  #a11y-scope, not a wrapper around it. */
export default function A11yProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<A11yPrefs>(DEFAULT_A11Y_PREFS)
  // True once the real stored prefs have been read — guards the very
  // first effect run (still DEFAULT_A11Y_PREFS) from writing that default
  // back over a real stored preference before it's had a chance to load.
  const hydrated = useRef(false)

  useEffect(() => {
    setPrefsState(loadPrefs())
    hydrated.current = true
  }, [])

  useEffect(() => {
    const scopeEl = document.getElementById(SCOPE_ID)
    if (scopeEl) applyPrefs(scopeEl, document.documentElement, prefs)
    if (hydrated.current) savePrefs(prefs)
  }, [prefs])

  function setPrefs(patch: Partial<A11yPrefs>) {
    setPrefsState((prev) => ({ ...prev, ...patch }))
  }
  function reset() {
    setPrefsState(DEFAULT_A11Y_PREFS)
  }

  return <A11yContext.Provider value={{ prefs, setPrefs, reset }}>{children}</A11yContext.Provider>
}

export function useA11y(): A11yContextValue {
  const ctx = useContext(A11yContext)
  if (!ctx) throw new Error('useA11y must be used within A11yProvider')
  return ctx
}
