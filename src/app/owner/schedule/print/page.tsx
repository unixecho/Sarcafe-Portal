import { redirect } from 'next/navigation'
import PrintView from '@/components/shifts/PrintView'
import ShiftsProvider from '@/components/shifts/ShiftsProvider'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isStaff } from '@/lib/staff/access'
import { canViewSchedule } from '@/lib/shifts/access'
import { getBranchBySlug } from '@/lib/branches/server'
import { todayISO, weekStartOf } from '@/lib/shifts/time'

export const dynamic = 'force-dynamic'

const WEEK_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// A standalone, deep-linkable page (no dashboard chrome) so the browser's
// print-to-PDF sees only the week grid. Gated by canViewSchedule (not
// canManageSchedule) — any staff scoped to the branch can pull up the
// printable sheet, same viewers StaffWorkspace already allows.
export default async function SchedulePrintPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; week?: string }>
}) {
  const { branch: branchSlug, week } = await searchParams

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

  if (!branchSlug) redirect('/owner/schedule')
  const branch = await getBranchBySlug(branchSlug)
  if (!branch) redirect('/owner/schedule')
  if (!canViewSchedule(me, branch.id)) redirect('/no-access')

  const weekStart = week && WEEK_PATTERN.test(week) ? weekStartOf(week) : weekStartOf(todayISO())

  return (
    <ShiftsProvider branchSlug={branch.slug} initialWeekStart={weekStart}>
      <PrintView />
    </ShiftsProvider>
  )
}
