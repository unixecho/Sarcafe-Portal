import type { Metadata } from 'next'
import PageTransitions from '@/components/PageTransitions'
import './globals.css'

export const metadata: Metadata = {
  title: 'Sarcafe',
  description: 'Sarcafe — פורטל, תפריט וניהול.',
}

// Default language is Hebrew/RTL, matching the current site and the
// truck's primary market; English/Arabic are runtime-switchable (ported in
// a later step, same localStorage-backed approach as the current site).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <PageTransitions />
        {/* Everything except fixed/portalled chrome lives inside this
            wrapper — the accessibility widget's contrast/grayscale/invert
            modes apply a `filter` here, never to <html>/<body>, so fixed
            overlays (sheets, dialogs, the widget itself) are never
            repositioned or recolored by a visitor's own display
            preferences. See components/a11y. */}
        <div id="a11y-scope">{children}</div>
      </body>
    </html>
  )
}
