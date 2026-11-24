import { redirect } from 'next/navigation'
import GlassDashboardShell from '@/components/glass/GlassDashboardShell'
import ScanVerifier from '@/components/identity/ScanVerifier'
import { isDeveloper } from '@/lib/checklists/developer'
import { isOp } from '@/lib/staff/access'
import { resolveStaffIdentity } from '@/lib/staff/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'אימות הטבה', robots: { index: false, follow: false }, referrer: 'no-referrer' as const }

// Verifying an organization employee's benefit card (FABLE-004). Any staff member may open the page (the middleware keeps /staff to
// staff); what they may DO is decided by the database on every call: an explicit scanner grant from the owner, on a proven Google
// session. Without one the page says so and does nothing. The page renders nothing about any person on the server.
export default async function StaffBenefitsScanPage() {
  const me = await resolveStaffIdentity()
  if (!me) redirect('/login?next=/staff/benefits/scan')
  return (
    <GlassDashboardShell title="אימות הטבה" account={{ developer: isDeveloper(me), manager: isOp(me) }}>
      <ScanVerifier />
    </GlassDashboardShell>
  )
}
