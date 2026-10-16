// Which pages are CUSTOMER-FACING — PURE: no React, no Next. scripts/check-a11y-scope.mjs runs this file.
//
// The accessibility widget and the "skip to main content" link are for customers (owner, 2026-10-16: "I don't want it to
// appear in the dashboard ... just customer facing pages"). Everything behind the staff and owner doors, the sign-in door
// and the register is a working tool used by a small known team: a floating button, or a link that slides in over the
// header, is in the way there.
//
// It is an ALLOW-list on purpose: a page nobody thought about (a new dashboard screen, a new staff tool) is private by
// default and never shows the widget. To give a new customer page the widget, add its prefix here.

/** Customer pages: the portal's front page and the pages a visitor or a customer with an order can reach. */
export const CUSTOMER_PREFIXES = ['/menu', '/order', '/accessibility', '/privacy', '/board'] as const

/** Is this a page a customer sees? The front page (`/`) is, exactly; the others by prefix. */
export function isCustomerFacing(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  if (pathname === '/') return true
  return CUSTOMER_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/** The classes and custom properties the accessibility widget writes onto <html>, and the filter it puts on #a11y-scope.
 *  Unmounting the widget does not undo them, so leaving a customer page for a private one must (see PublicA11yWidget). */
export const WIDGET_HTML_CLASSES = ['a11y-motion-off', 'a11y-highlight-links', 'a11y-highlight-headings', 'a11y-big-cursor', 'a11y-hide-images', 'a11y-readable-font'] as const
export const WIDGET_ROOT_VARS = ['--a11y-font-scale', '--a11y-letter-spacing', '--a11y-word-spacing', '--a11y-line-height', '--a11y-accent'] as const
