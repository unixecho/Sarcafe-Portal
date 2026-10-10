// Server-only auth guards for shift scheduling — mirrors lib/owner/guard.ts
// exactly: re-resolves the caller's staff row via the service-role client
// (staff has no select policy for authenticated), independent of whatever
// middleware already decided. This is the PRIMARY authorization layer for
// every shifts API route; the sched_* SQL functions (migration 024) re-check the
// matching action-specific rule from the explicit actor id as a second layer.
//
// A quick-login session (employee number + passcode) is floor-work-only
// everywhere in this app. Scheduling, requests and swaps require Google for
// employees as well as managers. PIN sessions use checklists and event POS.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { Unauthorized, Forbidden } from '@/lib/http/errors'
import type { StaffRow } from '@/lib/owner/guard'
import { canBrowsePublishedSchedule, canDelegateSchedule, canManageSchedule, canViewSchedule } from '@/lib/shifts/access'
import { resolveStaffIdentity } from '@/lib/staff/session'

type Resolved = { staff: StaffRow | null; scheduleManagers: string[]; quick: boolean }

async function resolve(branchId: string): Promise<Resolved> {
  const service = createServiceRoleClient()
  const identity = await resolveStaffIdentity()
  if (!identity) return { staff: null, scheduleManagers: [], quick: false }
  if (identity.via !== 'google' || identity.quick) throw Forbidden('כדי להשתמש בלוח המשמרות צריך להתחבר עם Google')
  const { data: settings } = await service.from('shift_settings').select('schedule_managers').eq('branch_id', branchId).maybeSingle()
  return { staff: identity as StaffRow, scheduleManagers: (settings?.schedule_managers as string[]) ?? [], quick: identity.quick }
}

export async function requireScheduleViewer(branchId: string): Promise<StaffRow> {
  const { staff } = await resolve(branchId)
  if (!staff) throw Unauthorized()
  if (!canViewSchedule(staff, branchId)) throw Forbidden('No access to this branch.')
  return staff
}

/** Read a frozen schedule (and request one of its open shifts) without granting
 *  any of the branch's draft, availability, swap or management permissions. */
export async function requirePublishedScheduleViewer(branchId: string): Promise<StaffRow> {
  const { staff } = await resolve(branchId)
  if (!staff) throw Unauthorized()
  if (canViewSchedule(staff, branchId)) return staff

  const { data: branch } = await createServiceRoleClient()
    .from('branches')
    .select('kind')
    .eq('id', branchId)
    .eq('active', true)
    .maybeSingle()
  const kind = branch?.kind === 'event' ? 'event' : branch ? 'permanent' : null
  if (!kind || !canBrowsePublishedSchedule(staff, branchId, kind)) throw Forbidden('No access to this branch.')
  return staff
}

export async function requireScheduleManager(branchId: string): Promise<StaffRow> {
  const { staff, scheduleManagers, quick } = await resolve(branchId)
  if (!staff) throw Unauthorized()
  if (quick) throw Forbidden('quick_session')
  if (!canManageSchedule(staff, branchId, scheduleManagers)) throw Forbidden('Schedule-manager access required.')
  return staff
}

/** Owner / general manager only — the delegation itself (who else may manage). */
export async function requireScheduleDelegator(branchId: string): Promise<StaffRow> {
  const { staff, quick } = await resolve(branchId)
  if (!staff) throw Unauthorized()
  if (quick) throw Forbidden('quick_session')
  if (!canDelegateSchedule(staff, branchId)) throw Forbidden('Only an owner or general manager can choose who manages the schedule.')
  return staff
}
