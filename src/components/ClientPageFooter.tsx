import Link from 'next/link'
import type { CSSProperties } from 'react'

/**
 * The accessibility statement has to be reachable from EVERY page a
 * customer can land on (IS 5568), and the order-tracking flow is a real
 * landing surface in its own right: a QR on a receipt drops someone
 * straight onto /order/<token> without ever passing the portal, and the
 * installed home-screen app opens at /order. Both previously ended with
 * no route to the statement at all.
 *
 * The floating a11y widget (mounted globally in layout.tsx) is the
 * TOOLBAR — the controls for changing contrast, text size and so on.
 * This is the STATEMENT — the document declaring the site's compliance
 * and its contact route. They're separate obligations and the widget
 * does not satisfy this one.
 *
 * role="contentinfo" is explicit because a <footer> nested inside <main>
 * does not get the implicit landmark role a top-level one does — same
 * note the portal's own footer carries.
 */
export default function ClientPageFooter() {
  return (
    <footer role="contentinfo" style={footerStyle}>
      <Link href="/accessibility" className="press" style={linkStyle}>
        הצהרת נגישות
      </Link>
      <span aria-hidden="true" style={{ color: 'var(--line-strong)' }}>
        ·
      </span>
      <Link href="/privacy" className="press" style={linkStyle}>
        מדיניות פרטיות
      </Link>
    </footer>
  )
}

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  width: '100%',
  marginTop: 'auto',
  paddingTop: 24,
}

// Underlined rather than tinted: at --text-faint the underline is the
// only thing marking these as links, and colour alone must never be that
// signal (WCAG 1.4.1). minHeight holds the app's --tap-min floor so a
// 0.75rem line is still a real touch target.
const linkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 10px',
  fontSize: '0.75rem',
  color: 'var(--text-faint)',
  textDecoration: 'underline',
}
