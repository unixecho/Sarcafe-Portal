'use client'

import { usePathname } from 'next/navigation'
import { isCustomerFacing } from '@/lib/a11y-scope'

/** "Skip to the main content" (WCAG 2.4.1) for the customer pages. It is the first focusable element of the document there.
 *  On the dashboards, the staff tools, the register and the sign-in door it is not rendered at all (owner, 2026-10-16: it
 *  looked out of place over the header); those pages have no page-wide navigation to skip. Its target is the
 *  <main id="main" tabIndex={-1}> that every route renders. The label is Hebrew-only on purpose: it must be right on the very
 *  first Tab, before a language is chosen. */
export default function SkipLink() {
  const pathname = usePathname()
  if (!isCustomerFacing(pathname)) return null
  return (
    <a href="#main" className="skip-link">
      דילוג לתוכן הראשי
    </a>
  )
}
