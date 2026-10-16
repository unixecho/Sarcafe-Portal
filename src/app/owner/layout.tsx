import type { Metadata } from 'next'
import StaffInstallIntro from '@/components/staff/StaffInstallIntro'
import ThemedApp from '@/components/app/ThemedApp'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { GeistSans } from 'geist/font/sans'

export const metadata: Metadata = {
  title: 'Sarcafe ניהול',
  manifest: '/staff-manifest.json',
  appleWebApp: { capable: true, title: 'Sarcafe צוות', statusBarStyle: 'black-translucent' },
}

// The owner and manager pages wear the same look the person chose for the staff app (src/lib/staff/theme.ts): one choice, the whole panel.
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const me = await resolveStaffIdentity().catch(() => null)
  return <ThemedApp staffId={me?.id} className={GeistSans.variable}><StaffInstallIntro />{children}</ThemedApp>
}
