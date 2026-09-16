import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import ScheduleWorkspaceShell from '@/components/shifts/ScheduleWorkspaceShell'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp, isStaff } from '@/lib/staff/access'
import { canManageSchedule } from '@/lib/shifts/access'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'
import type { Branch } from '@/lib/branches'

export const dynamic = 'force-dynamic'

// Manage-gated, but NOT via the usual hasAnyMenuEditAccess/isOp coarse
// checks — a delegated schedule manager can be any staff member (their
// badge might just be "barista"), so middleware only requires isStaff()
// here (see middleware.ts's STAFF_ONLY_PREFIXES) and this page does the
// real per-branch resolution: an owner/general_manager sees every branch
// they're allowed at; anyone else only the branch(es) that delegated them
// via that branch's shift_settings.schedule_managers[]. A staff member who
// manages nothing is redirected to /staff/schedule, not /no-access — they
// ARE real staff, just not a scheduler.
export default async function OwnerSchedulePage() {
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
  const candidateBranches = me!.branch_id ? allBranches.filter((b) => b.id === me!.branch_id) : allBranches

  const { data: settingsRows } = await service.from('shift_settings').select('branch_id, schedule_managers').in(
    'branch_id',
    candidateBranches.map((b) => b.id)
  )
  const managersByBranch = new Map((settingsRows ?? []).map((r) => [r.branch_id as string, (r.schedule_managers as string[]) ?? []]))

  const manageableBranches: Branch[] = candidateBranches.filter((b) => canManageSchedule(me, b.id, managersByBranch.get(b.id) ?? []))

  if (manageableBranches.length === 0) redirect('/staff/schedule')

  const cookieStore = await cookies()
  const initialBranch = resolveCurrentBranchSlug(manageableBranches, cookieStore.get(BRANCH_COOKIE)?.value)

  // /owner/dashboard is OP-only (see middleware.ts) — a general_manager or
  // delegated schedule manager can reach this page but not that one, so
  // their back button must point somewhere they can actually land.
  const backHref = isOp(me) ? '/owner/dashboard' : '/staff/schedule'

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="לוח משמרות" backHref={backHref} />
      <ScheduleWorkspaceShell branches={manageableBranches} initialBranch={initialBranch} />
    </main>
  )
}
