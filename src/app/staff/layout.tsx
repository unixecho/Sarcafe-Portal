import type { Metadata } from 'next'
import StaffInstallIntro from '@/components/staff/StaffInstallIntro'
import AppMotion from '@/components/app/AppMotion'
import { GeistSans } from 'geist/font/sans'

export const metadata: Metadata = {
  title: 'Sarcafe צוות',
  manifest: '/staff-manifest.json',
  appleWebApp: { capable: true, title: 'Sarcafe צוות', statusBarStyle: 'black-translucent' },
}

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <AppMotion className={GeistSans.variable}><StaffInstallIntro />{children}</AppMotion>
}
