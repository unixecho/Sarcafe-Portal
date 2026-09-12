/**
 * The recovered illustrated coffee-cart scene, reintroduced as a fixed
 * full-bleed layer behind a glass UI — recovers legacy-static-site's
 * `body::before` treatment (styles.css), gone in the rewrite. Mounted only
 * on public-facing pages (portal, digital menu, login, accessibility
 * statement) via each page's own top-level render — the owner app never
 * uses this, see globals.css's .public-backdrop rule (plain CSS
 * background-image, swapped for a wider crop ≥900px via media query —
 * same mechanism the legacy site used, not next/image, since this is a
 * decorative layer, not the page's LCP content).
 */
export default function PublicBackdrop() {
  return <div className="public-backdrop" aria-hidden="true" />
}
