// Server-only auth guards for shift scheduling — mirrors lib/owner/guard.ts
// exactly: re-resolves the caller's staff row via the service-role client
// (staff has no select policy for authenticated), independent of whatever
// middleware already decided. This is the PRIMARY authorization layer for
// every shifts API route; the sched_* SQL functions (migration 018) re-check the
// same rule from the explicit actor id as a second, independent layer.
//
// A quick-login session (employee number + passcode) is floor-work-only
// everywhere in this app (blueprint §1a.5): it may VIEW the schedule and make an
// employee's own requests, but never perform a manager act — a six-digit code is
// too weak a secret to approve a swap or publish a week, however privileged the
// person behind it is.

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { Unauthorized, Forbidden } from '@/lib/http/errors'
import type { StaffRow } from '@/lib/owner/guard'
import { canDelegateSchedule, canManageSchedule, canViewSchedule } from '@/lib/shifts/access'
import { isQuickSessionId, validatedSessionId } from '@/lib/pos/server/quick-login'

type Resolved = { staff: StaffRow | null; scheduleManagers: string[]; quick: boolean }

async function resolve(branchId: string, needQuick: boolean): Promise<Resolved> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { staff: null, scheduleManagers: [], quick: false }

  const service = createServiceRoleClient()
  const [{ data: staff }, { data: settings }, quick] = await Promise.all([
    service
      .from('staff')
      .select('id, auth_user_id, role, badge, branch_id, active, email, display_name, first_name, last_name')
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .maybeSingle(),
    service.from('shift_settings').select('schedule_managers').eq('branch_id', branchId).maybeSingle(),
    // A failed lookup rejects: a manager act must never be allowed on a guess.
    needQuick ? validatedSessionId(supabase).then(isQuickSessionId) : Promise.resolve(false),
  ])

  return { staff: (staff as StaffRow) ?? null, scheduleManagers: (settings?.schedule_managers as string[]) ?? [], quick }
}

export async function requireScheduleViewer(branchId: string): Promise<StaffRow> {
  const { staff } = await resolve(branchId, false)
  if (!staff) throw Unauthorized()
  if (!canViewSchedule(staff, branchId)) throw Forbidden('No access to this branch.')
  return staff
}

export async function requireScheduleManager(branchId: string): Promise<StaffRow> {
  const { staff, scheduleManagers, quick } = await resolve(branchId, true)
  if (!staff) throw Unauthorized()
  if (quick) throw Forbidden('quick_session')
  if (!canManageSchedule(staff, branchId, scheduleManagers)) throw Forbidden('Schedule-manager access required.')
  return staff
}

/** Owner / general manager only — the delegation itself (who else may manage). */
export async function requireScheduleDelegator(branchId: string): Promise<StaffRow> {
  const { staff, quick } = await resolve(branchId, true)
  if (!staff) throw Unauthorized()
  if (quick) throw Forbidden('quick_session')
  if (!canDelegateSchedule(staff, branchId)) throw Forbidden('Only an owner or general manager can choose who manages the schedule.')
  return staff
}
