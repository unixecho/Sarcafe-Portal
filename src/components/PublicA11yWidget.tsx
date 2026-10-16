'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { A11yWidgetConfig } from 'a11y-widget'
import { isCustomerFacing, WIDGET_HTML_CLASSES, WIDGET_ROOT_VARS } from '@/lib/a11y-scope'

const A11yWidget = dynamic(() => import('a11y-widget').then((module) => module.A11yWidget), { ssr: false })

// Module-level so the widget's memoised config keeps its identity across renders.
// `avoid` names the menu's back arrow so the launcher keeps clear of it; the cart,
// the language globe and anything else fixed or sticky are found by the widget itself.
const CONFIG: A11yWidgetConfig = {
  storageKey: 'sarcafe:a11y-prefs',
  statementHref: '/accessibility',
  avoid: ['.menu-back'],
}

/** The public accessibility control belongs to the customer experience only (the rule is lib/a11y-scope.ts).
 *
 *  The teardown is the part that matters: unmounting the widget does NOT undo what it applied. The package writes classes and
 *  custom properties onto <html> and a `filter` onto #a11y-scope, and only rewrites them from inside its provider. A client
 *  navigation from the menu (with high contrast on, say) to the dashboard would otherwise leave the dashboard filtered and
 *  enlarged by a button that is no longer there. So on a private page this strips every trace; back on a customer page the
 *  widget mounts again and re-applies the visitor's saved settings from localStorage by itself. Nothing is lost, only paused. */
export default function PublicA11yWidget() {
  const pathname = usePathname()
  const customer = isCustomerFacing(pathname)

  useEffect(() => {
    if (customer) return
    const html = document.documentElement
    html.classList.remove(...WIDGET_HTML_CLASSES)
    for (const name of WIDGET_ROOT_VARS) html.style.removeProperty(name)
    const scope = document.getElementById('a11y-scope')
    if (scope) scope.style.filter = ''
  }, [customer])

  if (!customer) return null
  return <A11yWidget config={CONFIG} />
}
