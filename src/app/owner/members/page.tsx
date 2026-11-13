import { redirect } from 'next/navigation'
import GlassDashboardShell from '@/components/glass/GlassDashboardShell'
import OwnerOrganizations from '@/components/identity/OwnerOrganizations'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { isOp } from '@/lib/staff/access'
import { isDeveloper } from '@/lib/checklists/developer'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'ארגונים ומחלקות', robots: { index: false, follow: false } }

// Organizations and departments (FABLE-002, docs/SARCAFE_IDENTITY.md). A full owner on a Google sign-in, like the other owner-only
// pages (the middleware keeps /owner/members to owners; a quick code session is refused here). The page itself reads nothing from
// the identity tables: the list and every action go through /api/owner/members/*, where requireOwnerBusiness and then the database
// decide again. A general manager, a schedule delegate and an employee never get here.
export default async function OwnerMembersPage() {
  const me = await resolveStaffIdentity()
  if (!me || me.via !== 'google') redirect('/login?next=/owner/members')
  if (!isOp(me) || me.quick) redirect('/no-access')
  return (
    <GlassDashboardShell title="ארגונים ומחלקות" account={{ developer: isDeveloper(me), manager: true }}>
      <OwnerOrganizations />
    </GlassDashboardShell>
  )
}
