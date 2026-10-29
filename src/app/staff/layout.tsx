import { Suspense } from 'react'
import type { Metadata } from 'next'
import StaffInstallIntro from '@/components/staff/StaffInstallIntro'
import StaffIdentityBeacon from '@/components/staff/StaffIdentityBeacon'
import NotificationsGate from '@/components/staff/NotificationsGate'
import ThemedApp from '@/components/app/ThemedApp'
import AppPageLoading from '@/components/app/AppPageLoading'
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

// The layout itself waits for nothing: who is signed in and the gate state are read inside <StaffShell>, behind a Suspense
// boundary, so the page's first bytes (the root layout with the staff app's opening screen, components/staff/StaffAppIntro.tsx)
// leave the server at once and the jokes play WHILE this loads, instead of the installed app showing a black screen until
// everything is ready (owner, 2026-10-29). `data-staff-loading` marks a still-loading screen; the opening screen ends as soon as
// none is left in the page. In a plain browser tab the same fallback is simply the usual loading skeleton.
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div data-staff-loading="" style={{ display: 'contents' }}><AppPageLoading /></div>}>
      <StaffShell>{children}</StaffShell>
    </Suspense>
  )
}

// Every staff page opens only on a device that can be told things (owner, 2026-10-16): on the Home Screen (phones) with
// notifications on. The rules are lib/staff/gate-rules.ts; the exemption an owner can give one employee, and who may carry on
// without alerts (management), are decided here on the server. The onboarding wizard (/staff/onboarding) runs the same steps
// itself, first, so the gate steps aside there. Someone nobody can identify gets the page as before (the page sends them to sign in).
async function StaffShell({ children }: { children: React.ReactNode }) {
  const me = await resolveStaffIdentity().catch(() => null)
  const state = me ? await loadGateState(me.id) : null
  // A six-digit-code sign-in (the QR code on the cart) is floor work only and is never stopped by the app set-up: its page
  // offers the Home Screen shortcut, and the schedule behind it needs the app sign-in, which the gate does guard.
  const codeSession = !!me && !(me.via === 'google' && !me.quick)
  const mode = codeSession ? 'off' : gateModeFor(me ? { role: me.role, badge: isDeveloper(me) ? 'developer' : me.badge, pushGateExempt: state?.exempt } : null)
  return (
    // The person's chosen look (neon until they choose) is drawn by ThemedApp: src/lib/staff/theme.ts, components/app/staff-themes.css.
    <ThemedApp staffId={me?.id} className={GeistSans.variable}>
      <StaffIdentityBeacon name={me?.first_name || me?.display_name || null} signedIn={!!me} />
      <NotificationsGate mode={mode}>
        <StaffInstallIntro />
        {children}
      </NotificationsGate>
    </ThemedApp>
  )
}
