import type { Metadata } from 'next'
import StaffInstallIntro from '@/components/staff/StaffInstallIntro'
import NotificationsGate from '@/components/staff/NotificationsGate'
import AppMotion from '@/components/app/AppMotion'
import ThemeScope from '@/components/staff/ThemeScope'
import { loadStaffTheme } from '@/lib/staff/theme-server'
import '@/components/app/staff-themes.css'
import { GeistSans } from 'geist/font/sans'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { loadGateState } from '@/lib/staff/gate-state'
import { gateModeFor } from '@/lib/staff/gate-rules'
import { isDeveloper } from '@/lib/checklists/developer'

export const metadata: Metadata = {
  title: 'Sarcafe צוות',
  manifest: '/staff-manifest.json',
  appleWebApp: { capable: true, title: 'Sarcafe צוות', statusBarStyle: 'black-translucent' },
}

// Every staff page opens only on a device that can be told things (owner, 2026-10-16): on the Home Screen (phones) with
// notifications on. The rules are lib/staff/gate-rules.ts; the exemption an owner can give one employee, and who may carry on
// without alerts (management), are decided here on the server. The onboarding wizard (/staff/onboarding) runs the same steps
// itself, first, so the gate steps aside there. Someone nobody can identify gets the page as before (the page sends them to sign in).
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const me = await resolveStaffIdentity().catch(() => null)
  const state = me ? await loadGateState(me.id) : null
  // The person's chosen look (neon until they choose): src/lib/staff/theme.ts, drawn by components/app/staff-themes.css.
  const { theme } = await loadStaffTheme(me?.id)
  // A six-digit-code sign-in (the QR code on the cart) is floor work only and is never stopped by the app set-up: its page
  // offers the Home Screen shortcut, and the schedule behind it needs the app sign-in, which the gate does guard.
  const codeSession = !!me && !(me.via === 'google' && !me.quick)
  const mode = codeSession ? 'off' : gateModeFor(me ? { role: me.role, badge: isDeveloper(me) ? 'developer' : me.badge, pushGateExempt: state?.exempt } : null)
  return (
    <AppMotion className={GeistSans.variable} theme={theme}>
      <ThemeScope theme={theme} />
      {theme === 'pass' && <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" precedence="default" />}
      <NotificationsGate mode={mode}>
        <StaffInstallIntro />
        {children}
      </NotificationsGate>
    </AppMotion>
  )
}
