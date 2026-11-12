import 'server-only'

import { cache } from 'react'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { isQuickSessionId, validatedSessionId } from '@/lib/pos/server/quick-login'
import type { IdentitySession } from '@/lib/identity/types'

// Who is asking, for the identity system. This WRAPS the existing sign-in resolution (src/lib/staff/session.ts, unchanged) and adds
// the one thing it cannot say: a verified auth user who is NOT staff (an organization's administrator). Such a user gets a session
// here and nowhere else: no staff row is created, and every staff / owner / POS guard keeps refusing them exactly as before.
//
// `failed`: the check itself could not be made (the auth server or the session lookup did not answer). The guard answers that with
// 503, never with access and never with "sign in again".
export type IdentitySessionLookup = { session: IdentitySession | null; failed: boolean }

const authFailed = (error: unknown) => {
  if (!error) return false
  const status = (error as { status?: unknown }).status
  return isAuthRetryableFetchError(error) || (typeof status === 'number' && status >= 500)
}

export const resolveIdentitySession = cache(async function resolveIdentitySession(): Promise<IdentitySessionLookup> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  const staff = await resolveStaffIdentity()

  if (user) {
    // a failed lookup of the session kind is "could not check", never "full"
    let quick: boolean
    try {
      quick = await validatedSessionId(supabase).then(isQuickSessionId)
    } catch {
      return { session: null, failed: true }
    }
    // the staff row counts only when it is THIS auth user's row (an employee-code cookie next to someone else's Google session does not)
    const own = staff && staff.via === 'google' && staff.auth_user_id === user.id ? staff : null
    return {
      session: { authUserId: user.id, via: 'google', full: !quick, staff: own ? { id: own.id, role: own.role, badge: own.badge, branch_id: own.branch_id } : null },
      failed: false,
    }
  }

  if (staff && staff.via === 'employee_code') {
    return { session: { authUserId: null, via: 'employee_code', full: false, staff: { id: staff.id, role: staff.role, badge: staff.badge, branch_id: staff.branch_id } }, failed: false }
  }
  return { session: null, failed: authFailed(authError) }
})
