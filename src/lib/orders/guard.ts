// Server-only auth guards for the POS — mirrors lib/shifts/guard.ts
// exactly: re-resolves the caller's staff row via the service-role client
// (staff has no select policy for authenticated), independent of whatever
// middleware already decided. This is the PRIMARY authorization layer for
// every orders API route; migration 017's RLS/functions are a backstop.

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { Unauthorized, Forbidden } from '@/lib/http/errors'
import type { StaffRow } from '@/lib/owner/guard'
import { canWorkOrders, canCancelOrder } from './access'

async function resolveStaff(): Promise<StaffRow | null> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const service = createServiceRoleClient()
  const { data: row } = await service
    .from('staff')
    .select('id, auth_user_id, role, badge, branch_id, active, email, display_name, first_name, last_name')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle()

  return (row as StaffRow) ?? null
}

/** Baseline POS access — take an order, advance its status, mark it paid. */
export async function requireOrderStaff(branchId: string): Promise<StaffRow> {
  const staff = await resolveStaff()
  if (!staff) throw Unauthorized()
  if (!canWorkOrders(staff, branchId)) throw Forbidden('No access to this branch.')
  return staff
}

/** Cancellation only — owner or general_manager. */
export async function requireOrderManager(branchId: string): Promise<StaffRow> {
  const staff = await resolveStaff()
  if (!staff) throw Unauthorized()
  if (!canCancelOrder(staff, branchId)) throw Forbidden('Only an owner or general manager can cancel an order.')
  return staff
}
