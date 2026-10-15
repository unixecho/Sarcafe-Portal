'use client'

import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { A11yWidgetConfig } from 'a11y-widget'

const A11yWidget = dynamic(() => import('a11y-widget').then((module) => module.A11yWidget), { ssr: false })

const PRIVATE_PREFIXES = ['/login', '/owner', '/staff', '/pos', '/checklists', '/no-access']

// Module-level so the widget's memoised config keeps its identity across renders.
// `avoid` names the menu's back arrow so the launcher keeps clear of it; the cart,
// the language globe and anything else fixed or sticky are found by the widget itself.
const CONFIG: A11yWidgetConfig = {
  storageKey: 'sarcafe:a11y-prefs',
  statementHref: '/accessibility',
  avoid: ['.menu-back'],
}

/** The public accessibility control belongs to the customer experience only. */
export default function PublicA11yWidget() {
  const pathname = usePathname()
  if (PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null
  return <A11yWidget config={CONFIG} />
}
