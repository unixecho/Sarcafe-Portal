import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { Unauthorized, Forbidden } from '@/lib/http/errors'
import { isOp, canEditMenu, type AccessRow } from '@/lib/staff/access'
import { isQuickSessionId, validatedSessionId } from '@/lib/pos/server/quick-login'

// email/display_name/first_name/last_name are carried here (not just
// role/badge/branch_id) so callers that need to attribute an action — the
// menu_audit writer in lib/menu/audit.ts — don't need a second staff query
// just to snapshot who did it.
export type StaffRow = AccessRow & {
  id: string
  auth_user_id: string
  email: string | null
  display_name: string | null
  first_name: string | null
  last_name: string | null
}

// `quick`: the session was opened with an employee number + passcode, not Google. Such
// a session is floor-work-only (blueprint §1a.5), so both guards below refuse it.
async function resolveStaff(): Promise<{ staff: StaffRow | null; quick: boolean }> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { staff: null, quick: false }

  const service = createServiceRoleClient()
  const [{ data: row }, quick] = await Promise.all([
    service
      .from('staff')
      .select('id, auth_user_id, role, badge, branch_id, active, email, display_name, first_name, last_name')
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .maybeSingle(),
    // A failed lookup rejects: an owner route must never be opened on a guess.
    validatedSessionId(supabase).then(isQuickSessionId),
  ])

  return { staff: (row as StaffRow) ?? null, quick }
}

/** Full admin only. Re-resolves the caller's role server-side via the
 * service-role client, independent of whatever middleware already decided —
 * defense in depth. Never trust a client-supplied role. */
export async function requireOwner(): Promise<StaffRow> {
  const { staff, quick } = await resolveStaff()
  if (!staff) throw Unauthorized()
  if (quick) throw Forbidden('quick_session')
  if (!isOp(staff)) throw Forbidden('Owner access required.')
  return staff
}

/** Menu-editor access, scoped to one branch. OP can edit any branch; a
 * general_manager only their own (or every branch if their branch_id is
 * null). */
export async function requireMenuEditor(branchId: string): Promise<StaffRow> {
  const { staff, quick } = await resolveStaff()
  if (!staff) throw Unauthorized()
  if (quick) throw Forbidden('quick_session')
  if (!canEditMenu(staff, branchId)) throw Forbidden('Menu-editor access required for this branch.')
  return staff
}
