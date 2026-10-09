'use client'

import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'

const A11yWidget = dynamic(() => import('a11y-widget').then((module) => module.A11yWidget), { ssr: false })

const PRIVATE_PREFIXES = ['/login', '/owner', '/staff', '/pos', '/checklists', '/no-access']

/** The public accessibility control belongs to the customer experience only. */
export default function PublicA11yWidget() {
  const pathname = usePathname()
  if (PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null
  return <A11yWidget config={{ storageKey: 'sarcafe:a11y-prefs', statementHref: '/accessibility' }} />
}
