'use client'

import { useEffect, useState } from 'react'
import { Accessibility } from 'lucide-react'
import { at } from '@/lib/a11y/i18n'
import A11yPanel from './A11yPanel'
import type { Lang } from '@/lib/menu/types'

/** LanguageSwitch's own useLanguage() is per-instance state (its own
 * useState, no shared context) — fine for a single page, but this widget
 * is mounted once at the layout level and outlives every page navigation,
 * so a separate instance of that hook here would go stale the moment a
 * visitor changed language on the page itself. useLanguage() does
 * reliably write document.documentElement.lang on every change, though,
 * so watching THAT is what actually stays correct regardless of which
 * page (or how many independent useLanguage() calls) set it. */
function useDocumentLang(): Lang {
  const [lang, setLang] = useState<Lang>('he')
  useEffect(() => {
    const read = () => setLang((document.documentElement.lang as Lang) || 'he')
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributeFilter: ['lang'] })
    return () => observer.disconnect()
  }, [])
  return lang
}

/** The one fixed control this widget adds outside #a11y-scope. Bottom-right
 * — the corner visitors already associate with "accessibility tools live
 * here" (BLUEPRINT.md §7.3) — and a PHYSICAL corner (insetInlineEnd would
 * flip under RTL/LTR and become a different corner depending on language,
 * which fixed chrome must never do, per §6.3 rule 4). Already outside any
 * page-transition-transformed ancestor by construction (layout.tsx mounts
 * this as a sibling of #a11y-scope, both direct children of <body>), so it
 * needs no ModalPortal. */
export default function A11yLauncher() {
  const lang = useDocumentLang()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="press a11y-launcher"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={at('launcherLabel', lang)}
      >
        <Accessibility size={24} aria-hidden="true" />
      </button>
      <A11yPanel open={open} onClose={() => setOpen(false)} lang={lang} />
    </>
  )
}
