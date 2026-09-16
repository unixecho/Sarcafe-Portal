import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import StaffScheduleShell from '@/components/shifts/StaffScheduleShell'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isStaff } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

// Self-service schedule view for any active staff member — the read side
// of canViewSchedule() is just "branch_id is null (all-branch) or matches",
// so unlike /owner/schedule there's no per-branch delegation to resolve:
// a staff row scoped to one branch sees only that branch, an all-branch row
// (or an owner/GM who has no schedules to manage) sees every branch.
export default async function StaffSchedulePage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceRoleClient()
  const { data: me } = await service
    .from('staff')
    .select('id, role, badge, branch_id')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle()
  if (!isStaff(me)) redirect('/no-access')

  const allBranches = await getBranches()
  const visibleBranches = me!.branch_id ? allBranches.filter((b) => b.id === me!.branch_id) : allBranches

  const cookieStore = await cookies()
  const initialBranch = resolveCurrentBranchSlug(visibleBranches, cookieStore.get(BRANCH_COOKIE)?.value)

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="לוח משמרות" />
      <StaffScheduleShell branches={visibleBranches} initialBranch={initialBranch} />
    </main>
  )
}
