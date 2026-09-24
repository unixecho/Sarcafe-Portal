import type { Metadata } from 'next'
import PageTransitions from '@/components/PageTransitions'
import { A11yWidget } from 'a11y-widget'
import './globals.css'

export const metadata: Metadata = {
  title: 'Sarcafe',
  description: 'Sarcafe — פורטל, תפריט וניהול.',
  manifest: '/manifest.json',
  icons: {
    // Without an explicit apple-touch-icon, iOS falls back to a
    // screenshot of the page as the home-screen icon — the single most
    // visible "this isn't a real app" tell there is.
    apple: '/sarcafe-logo.png',
  },
  appleWebApp: {
    // Lets a customer's "Add to Home Screen" (the one prerequisite iOS
    // Safari has for Web Push at all — see lib/push/client.ts's
    // isIosDevice()) launch as a standalone app pointed at /order,
    // rather than defaulting to whatever page they happened to add it
    // from.
    capable: true,
    title: 'SarCafe',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport = {
  themeColor: '#150f0c',
}

// Default language is Hebrew/RTL, matching the current site and the
// truck's primary market; English/Arabic are runtime-switchable (ported in
// a later step, same localStorage-backed approach as the current site).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        {/* First focusable element in the document — WCAG 2.4.1 (Level A).
            It sits ahead of PageTransitions and the a11y-scope wrapper so
            nothing can get in front of it in the tab order. Its target is
            the <main id="main" tabIndex={-1}> that every route renders;
            the tabIndex is what makes this MOVE focus rather than merely
            scroll, without which the link is decorative. */}
        <a href="#main" className="skip-link">
          דילוג לתוכן הראשי
        </a>
        <PageTransitions />
        {/* Everything except fixed/portalled chrome lives inside this
            wrapper — the accessibility widget's contrast/grayscale/invert
            modes apply a `filter` here, never to <html>/<body>, so fixed
            overlays (sheets, dialogs, the widget itself) are never
            repositioned or recolored by a visitor's own display
            preferences. See github.com/unixecho/a11y-widget's README
            ("Integration contract"). */}
        <div id="a11y-scope">{children}</div>
        {/* The shared accessibility widget (github.com/unixecho/a11y-widget)
            — extracted 2026-09-24 from this file's own former in-house build
            (src/components/a11y, src/lib/a11y) once this copy had already
            drifted from AyekaBar's independently-maintained one. Both apps
            and any future one now depend on the same package instead of
            re-implementing it. `storageKey` is this app's PRE-EXISTING
            localStorage key, passed through deliberately so migrating onto
            the package did not reset visitors' already-saved preferences.
            Outside the scope on purpose — see the paragraph above. */}
        <A11yWidget config={{ storageKey: 'sarcafe:a11y-prefs', statementHref: '/accessibility' }} />
      </body>
    </html>
  )
}
