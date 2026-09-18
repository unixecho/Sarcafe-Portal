// Authorization predicates for the POS — TS twin of the SQL functions in
// migration 017 (can_work_orders/can_cancel_order). Every predicate here
// MUST stay in sync with its SQL counterpart, same discipline
// lib/staff/access.ts documents for is_op()/is_menu_editor().

import type { AccessRow } from '@/lib/staff/access'
import { isOp } from '@/lib/staff/access'

/** Take/advance/pay: any active staff row scoped to this branch (or
 *  all-branch) — the counter/kitchen work anyone on shift does. */
export function canWorkOrders(row: AccessRow | null | undefined, branchId: string): boolean {
  if (!row) return false
  return row.branch_id === null || row.branch_id === undefined || row.branch_id === branchId
}

/** Cancel: deliberately narrower — the audit's own rule ("kitchen must
 *  never get cancellation authority"). Owner or general_manager only,
 *  same two-tier shape as canEditMenu(). */
export function canCancelOrder(row: AccessRow | null | undefined, branchId: string): boolean {
  if (!row) return false
  if (isOp(row)) return true
  return row.badge === 'general_manager' && (row.branch_id === null || row.branch_id === undefined || row.branch_id === branchId)
}
