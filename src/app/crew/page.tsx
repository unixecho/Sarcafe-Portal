import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { resolveStaffIdentity } from '@/lib/staff/session'
import CrewLogin from './CrewLogin'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Sarcafe | צ׳קליסטים למשמרת', robots: { index: false, follow: false } }

// The address printed on the cart (as a QR code, and as a plain link). Someone already signed in goes straight to their page.
export default async function CrewPage() {
  const me = await resolveStaffIdentity().catch(() => null)
  if (me) redirect('/staff')
  return <CrewLogin />
}
