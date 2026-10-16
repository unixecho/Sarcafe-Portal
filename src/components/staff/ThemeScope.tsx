'use client'

import { useEffect } from 'react'
import { isStaffTheme } from '@/lib/staff/theme'

/** Fired by the style picker so the whole screen changes at once, before the server has even answered. */
export const THEME_EVENT = 'sarcafe:staff-theme'

/** Puts the look on <html> (so sheets and menus that portal to <body> match) and on the staff wrapper; the wrapper is also drawn
 *  by the server with the same value, so there is no flash on load. The attribute is removed when the person leaves the staff app. */
export function applyTheme(theme: string) {
  if (!isStaffTheme(theme)) return
  document.documentElement.dataset.staffTheme = theme
  document.querySelector('.native-app[data-staff-theme]')?.setAttribute('data-staff-theme', theme)
}

export default function ThemeScope({ theme }: { theme: string }) {
  useEffect(() => {
    applyTheme(theme)
    const onChange = (event: Event) => applyTheme(String((event as CustomEvent<string>).detail))
    window.addEventListener(THEME_EVENT, onChange)
    return () => {
      window.removeEventListener(THEME_EVENT, onChange)
      delete document.documentElement.dataset.staffTheme
    }
  }, [theme])
  return null
}
