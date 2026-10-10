import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import StaffScheduleShell from '@/components/shifts/StaffScheduleShell'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

// Every Google-linked employee can browse the frozen schedules of permanent
// branches. Event schedules remain visible only to staff assigned to that event.
export default async function StaffSchedulePage() {
  const me = await resolveStaffIdentity()
  if (!me || me.quick || me.via !== 'google') redirect('/login?next=/staff/schedule')

  const allBranches = await getBranches({ includeEvents: true })
  const visibleBranches = allBranches.filter((branch) => branch.kind !== 'event' || branch.id === me.branch_id)

  const cookieStore = await cookies()
  const initialBranch = resolveCurrentBranchSlug(visibleBranches, cookieStore.get(BRANCH_COOKIE)?.value)

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 1560, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="לוח משמרות" backHref="/staff" />
      <StaffScheduleShell branches={visibleBranches} initialBranch={initialBranch} />
    </main>
  )
}
