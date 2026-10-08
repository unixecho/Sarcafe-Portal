import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import StaffScheduleShell from '@/components/shifts/StaffScheduleShell'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

// Self-service schedule view for any active staff member — the read side
// of canViewSchedule() is just "branch_id is null (all-branch) or matches",
// so unlike /owner/schedule there's no per-branch delegation to resolve:
// a staff row scoped to one branch sees only that branch, an all-branch row
// (or an owner/GM who has no schedules to manage) sees every branch.
export default async function StaffSchedulePage() {
  const me = await resolveStaffIdentity()
  if (!me || me.quick || me.via !== 'google') redirect('/login?next=/staff/schedule')

  const allBranches = await getBranches({ includeEvents: true })
  const visibleBranches = me.branch_id ? allBranches.filter((b) => b.id === me.branch_id) : allBranches

  const cookieStore = await cookies()
  const initialBranch = resolveCurrentBranchSlug(visibleBranches, cookieStore.get(BRANCH_COOKIE)?.value)

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 1040, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="לוח משמרות" backHref="/staff" />
      <StaffScheduleShell branches={visibleBranches} initialBranch={initialBranch} />
    </main>
  )
}
