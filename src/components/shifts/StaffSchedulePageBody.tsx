import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import StaffScheduleShell from '@/components/shifts/StaffScheduleShell'
import OnShiftNow from '@/components/shifts/OnShiftNow'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { loadOnShiftNow } from '@/lib/staff/on-shift'
import { loadConstraintBranches } from '@/lib/shifts/constraint-branches'
import { wallClockNow } from '@/lib/shifts/time'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'
import type { ScheduleEntry } from '@/lib/shifts/entry'

// Every Google-linked employee can browse the frozen schedules of permanent
// branches. Event schedules remain visible only to staff assigned to that event.
//
// Served at /staff/schedule and at /staff/schedule/<branch>: the second is the link
// that goes out with a shared schedule, so it opens straight on that branch. The branch
// is a path segment because a signed-out visitor is sent through /login?next=… and
// that value cannot carry a query. An unknown or not-visible branch falls back to the
// person's usual one instead of failing.
export default async function StaffSchedulePageBody({ branchSlug, entry = {} }: { branchSlug?: string; entry?: ScheduleEntry }) {
  const here = branchSlug && /^[A-Za-z0-9_-]+$/.test(branchSlug) ? `/staff/schedule/${branchSlug}` : '/staff/schedule'
  const me = await resolveStaffIdentity()
  if (!me || me.quick || me.via !== 'google') redirect(`/login?next=${here}`)

  const allBranches = await getBranches({ includeEvents: true })
  const visibleBranches = allBranches.filter((branch) => branch.kind !== 'event' || branch.id === me.branch_id)

  const cookieStore = await cookies()
  const requested = branchSlug && visibleBranches.some((branch) => branch.slug === branchSlug) ? branchSlug : cookieStore.get(BRANCH_COOKIE)?.value
  const initialBranch = resolveCurrentBranchSlug(visibleBranches, requested)

  // Who is on shift right now, and which branches this person may send constraints for (with each branch's hours). Both are
  // extras around the schedule: if either read fails the schedule itself must still open.
  const service = createServiceRoleClient()
  const permanent = visibleBranches.filter((branch) => branch.kind !== 'event').map((branch) => ({ id: branch.id, slug: branch.slug, name: branch.name.he }))
  const [onShift, constraintBranches] = await Promise.all([
    loadOnShiftNow(service, me.branch_id ?? null).catch(() => null),
    // null (a failed read) means "no restriction known": the form then behaves as it did before, and the server still refuses wrong branches.
    loadConstraintBranches(service, { id: me.id, branch_id: me.branch_id ?? null }, permanent).catch(() => null),
  ])

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 1560, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="לוח משמרות" backHref="/staff" />
      {onShift && <OnShiftNow branches={onShift} viewerId={me.id} clock={wallClockNow('Asia/Jerusalem').time} />}
      <StaffScheduleShell branches={visibleBranches} initialBranch={initialBranch} entry={entry} constraintBranches={constraintBranches} />
    </main>
  )
}
