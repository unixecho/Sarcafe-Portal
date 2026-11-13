import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import ThemeScope from '@/components/staff/ThemeScope'
import { loadStaffTheme } from '@/lib/staff/theme-server'
import '@/components/app/staff-themes.css'

export const metadata: Metadata = { title: 'Sarcafe הטבות', robots: { index: false, follow: false } }

// The /benefits pages wear the app's looks (the five token sets of staff-themes.css, selected by data-staff-theme) so the shared
// glass pieces read correctly in each of them. The people here are not staff, so there is no account to read a look from: the
// device's own choice (the look cookie) or the default. This is the look wrapper only: no staff shell, no dock, no install sheet,
// and none of the staff app's motion code.
export default async function BenefitsLayout({ children }: { children: React.ReactNode }) {
  const { theme } = await loadStaffTheme(null)
  return (
    <div className={`native-app ${GeistSans.variable}`} data-staff-theme={theme}>
      <ThemeScope theme={theme} />
      {theme === 'pass' && <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" precedence="default" />}
      {children}
    </div>
  )
}
