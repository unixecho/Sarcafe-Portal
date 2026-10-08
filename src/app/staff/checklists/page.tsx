import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import StaffChecklistWorkspace from '@/components/checklists/StaffChecklistWorkspace'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

export default async function StaffChecklistsPage() {
  const me = await resolveStaffIdentity()
  if (!me) redirect('/login?next=/staff/checklists&quick=1')
  const allBranches = await getBranches()
  const visibleBranches = me.branch_id ? allBranches.filter((branch) => branch.id === me.branch_id) : allBranches
  const initialBranch = resolveCurrentBranchSlug(visibleBranches, (await cookies()).get(BRANCH_COOKIE)?.value)
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 760, margin: '0 auto', padding: '0 16px 40px' }}>
      <OwnerHeader title="צ׳קליסט למשמרת" backHref="/staff" />
      <StaffChecklistWorkspace branches={visibleBranches} initialBranch={initialBranch} />
    </main>
  )
}
