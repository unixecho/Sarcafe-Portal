'use client'

import { useEffect } from 'react'
import { applyTheme } from '@/lib/staff/theme-transition'

/** Puts the look on <html> (so sheets and menus that portal to <body> match) and on the staff wrapper; the wrapper is also drawn by the
 *  server with the same value, so there is no flash on load. The attribute is removed when the person leaves the themed part of the app
 *  (staff, owner, cart sign-in). A change made by the picker goes through theme-transition.ts, which also applies it. */
export default function ThemeScope({ theme }: { theme: string }) {
  useEffect(() => {
    applyTheme(theme)
    return () => { delete document.documentElement.dataset.staffTheme }
  }, [theme])
  return null
}
