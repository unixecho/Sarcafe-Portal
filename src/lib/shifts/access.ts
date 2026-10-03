// Authorization predicates for shift scheduling — TS twin of the SQL
// functions sched_can_manage / sched_can_view / sched_is_op (migration 018;
// is_schedule_manager / can_view_schedule in 010 are aligned to the same rules).
// Every predicate here MUST stay in sync with its SQL counterpart, same
// discipline lib/staff/access.ts documents for is_op()/is_menu_editor().
//
//   view    an owner (never branch-scoped), or any active staff row scoped to
//           this branch (or to all branches)
//   manage  an owner, or — within their branch scope — a general_manager or
//           someone this branch delegated via shift_settings.schedule_managers[]
//   delegate  deliberately narrower than manage: owner / general_manager only,
//           so a delegate can hand out schedule work but not the delegation itself

import type { AccessRow } from '@/lib/staff/access'
import { isOp } from '@/lib/staff/access'

type ScheduleAccessRow = AccessRow & { id?: string }

const inScope = (row: AccessRow, branchId: string) => row.branch_id === null || row.branch_id === undefined || row.branch_id === branchId

/** View: an owner, or any active staff row scoped to this branch (or all-branch). */
export function canViewSchedule(row: ScheduleAccessRow | null | undefined, branchId: string): boolean {
  if (!row) return false
  if (isOp(row)) return true
  return inScope(row, branchId)
}

/** Manage: owner, or (in scope) badge='general_manager', or delegated via this
 *  branch's shift_settings.schedule_managers[]. */
export function canManageSchedule(
  row: ScheduleAccessRow | null | undefined,
  branchId: string,
  scheduleManagers: readonly string[]
): boolean {
  if (!row) return false
  if (isOp(row)) return true
  if (!inScope(row, branchId)) return false
  if (row.badge === 'general_manager') return true
  return !!row.id && scheduleManagers.includes(row.id)
}

/** Delegate: owner/general_manager only. */
export function canDelegateSchedule(row: ScheduleAccessRow | null | undefined, branchId: string): boolean {
  if (!row) return false
  if (isOp(row)) return true
  return row.badge === 'general_manager' && inScope(row, branchId)
}
