import type { ReactNode } from 'react'

/**
 * The recovered illustrated coffee-cart scene, wrapping every public-facing
 * page's <main> — recovers legacy-static-site's `body::before` treatment
 * (styles.css), gone in the rewrite. See globals.css's .public-backdrop
 * rule for the actual image/gradient (plain CSS background, swapped for a
 * wider crop ≥900px via media query — same mechanism the legacy site used,
 * not next/image, since this is a decorative layer, not the page's LCP
 * content).
 *
 * Wraps <main> instead of rendering as a `position: fixed; z-index: -1`
 * sibling INSIDE it, which is what this used to be. That combination —
 * fixed position, negative z-index — reliably goes unpainted in Chromium
 * after a BACK-direction document.startViewTransition() finishes: not just
 * this element, ANY negative-z-index layer, freshly created ones included
 * (confirmed live, repeatedly — GPU-layer promotion, a forced repaint, and
 * giving it its own view-transition-name to opt out of the root capture
 * all failed to fix it). `background-attachment: fixed` on a container that
 * naturally paints behind its own children sidesteps the whole stacking
 * question — there is no z-index anywhere in this scheme for the browser
 * to get wrong.
 */
export default function PublicBackdrop({ children }: { children: ReactNode }) {
  return <div className="public-backdrop">{children}</div>
}
