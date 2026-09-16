// Authorization predicates for shift scheduling — TS twin of the SQL
// functions in migration 010 (is_schedule_manager/can_delegate_schedule/
// can_view_schedule). Every predicate here MUST stay in sync with its SQL
// counterpart, same discipline lib/staff/access.ts documents for
// is_op()/is_menu_editor().

import type { AccessRow } from '@/lib/staff/access'
import { isOp } from '@/lib/staff/access'

type ScheduleAccessRow = AccessRow & { id?: string }

/** Manage: owner, badge='general_manager', or delegated via this branch's
 *  shift_settings.schedule_managers[]. */
export function canManageSchedule(
  row: ScheduleAccessRow | null | undefined,
  branchId: string,
  scheduleManagers: readonly string[]
): boolean {
  if (!row) return false
  if (isOp(row)) return true
  if (row.badge === 'general_manager' && (row.branch_id === null || row.branch_id === undefined || row.branch_id === branchId)) {
    return true
  }
  return !!row.id && scheduleManagers.includes(row.id)
}

/** Delegate: deliberately narrower than manage — a delegate can be handed
 *  scheduling work but not hand it out themselves. Owner/general_manager
 *  only. */
export function canDelegateSchedule(row: ScheduleAccessRow | null | undefined, branchId: string): boolean {
  if (!row) return false
  if (isOp(row)) return true
  return row.badge === 'general_manager' && (row.branch_id === null || row.branch_id === undefined || row.branch_id === branchId)
}

/** View: any active staff row scoped to this branch (or all-branch). */
export function canViewSchedule(row: ScheduleAccessRow | null | undefined, branchId: string): boolean {
  if (!row) return false
  return row.branch_id === null || row.branch_id === undefined || row.branch_id === branchId
}
