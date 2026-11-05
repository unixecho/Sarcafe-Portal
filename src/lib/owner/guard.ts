import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { ApiError, Unauthorized, Forbidden } from '@/lib/http/errors'
import { isOp, canEditMenu, hasAnyMenuEditAccess, type AccessRow } from '@/lib/staff/access'
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
// `failed` says the check itself could not be made (the auth server or the database did not answer), which is not the same as
// "not signed in". requireAnyMenuEditor answers it with 503; the older guards keep their answer (no user → 401).
async function resolveStaff(): Promise<{ staff: StaffRow | null; quick: boolean; failed: boolean }> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (!user) {
    const status = (authError as { status?: unknown } | null)?.status
    return { staff: null, quick: false, failed: Boolean(authError) && (isAuthRetryableFetchError(authError) || (typeof status === 'number' && status >= 500)) }
  }

  const service = createServiceRoleClient()
  const [{ data: row, error: rowError }, quick] = await Promise.all([
    service
      .from('staff')
      .select('id, auth_user_id, role, badge, branch_id, active, email, display_name, first_name, last_name')
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .maybeSingle(),
    // A failed lookup rejects: an owner route must never be opened on a guess.
    validatedSessionId(supabase).then(isQuickSessionId),
  ])

  return { staff: (row as StaffRow) ?? null, quick, failed: Boolean(rowError) }
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

/** Someone who manages at least one branch (an owner, or a general manager), signed in fully. For a route that must say who may
 * call it BEFORE it looks anything up (so a signed-out caller learns nothing, e.g. which branch names exist); the per-branch check
 * (canEditMenu) follows once the branch is known. */
export async function requireAnyMenuEditor(): Promise<StaffRow> {
  const { staff, quick, failed } = await resolveStaff()
  if (failed) throw new ApiError(503, 'unavailable', 'לא הצלחנו לבדוק את ההרשאה כרגע. נסו שוב בעוד רגע.')
  if (!staff) throw Unauthorized()
  if (quick) throw Forbidden('quick_session')
  if (!hasAnyMenuEditAccess(staff)) throw Forbidden('Menu-editor access required.')
  return staff
}
