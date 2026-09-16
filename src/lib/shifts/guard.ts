// Server-only auth guards for shift scheduling — mirrors lib/owner/guard.ts
// exactly: re-resolves the caller's staff row via the service-role client
// (staff has no select policy for authenticated), independent of whatever
// middleware already decided. This is the PRIMARY authorization layer for
// every shifts API route; the SQL functions/RLS in migration 010 are a
// backstop, not the other way around — matching this app's own established
// posture (requireMenuEditor/requireOwner + service role), not AyekaBar's
// RLS-is-the-only-gate approach.

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { Unauthorized, Forbidden } from '@/lib/http/errors'
import type { StaffRow } from '@/lib/owner/guard'
import { canManageSchedule, canViewSchedule } from '@/lib/shifts/access'

async function resolveStaffAndManagers(branchId: string): Promise<{ staff: StaffRow | null; scheduleManagers: string[] }> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { staff: null, scheduleManagers: [] }

  const service = createServiceRoleClient()
  const [{ data: staff }, { data: settings }] = await Promise.all([
    service
      .from('staff')
      .select('id, auth_user_id, role, badge, branch_id, active, email, display_name, first_name, last_name')
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .maybeSingle(),
    service.from('shift_settings').select('schedule_managers').eq('branch_id', branchId).maybeSingle(),
  ])

  return { staff: (staff as StaffRow) ?? null, scheduleManagers: (settings?.schedule_managers as string[]) ?? [] }
}

export async function requireScheduleViewer(branchId: string): Promise<StaffRow> {
  const { staff } = await resolveStaffAndManagers(branchId)
  if (!staff) throw Unauthorized()
  if (!canViewSchedule(staff, branchId)) throw Forbidden('No access to this branch.')
  return staff
}

export async function requireScheduleManager(branchId: string): Promise<StaffRow> {
  const { staff, scheduleManagers } = await resolveStaffAndManagers(branchId)
  if (!staff) throw Unauthorized()
  if (!canManageSchedule(staff, branchId, scheduleManagers)) throw Forbidden('Schedule-manager access required.')
  return staff
}
