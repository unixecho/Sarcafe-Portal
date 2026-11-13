import 'server-only'

import { cache } from 'react'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { isQuickSessionId } from '@/lib/pos/server/quick-login'
import { proveGoogleSession, type SessionClaims } from '@/lib/identity/session-proof'
import type { IdentitySession } from '@/lib/identity/types'

// Who is asking, for the identity system. This WRAPS the existing sign-in resolution (src/lib/staff/session.ts, unchanged) and adds
// the one thing it cannot say: a verified auth user who is NOT staff (an organization's administrator). Such a user gets a session
// here and nowhere else: no staff row is created, and every staff / owner / POS guard keeps refusing them exactly as before.
//
// `failed`: the check itself could not be made (the auth server or the session lookup did not answer). The guard answers that with
// 503, never with access and never with "sign in again".
//
// `via` says how THIS session signed in (src/lib/identity/session-proof.ts): `google` only when the current access token's claims,
// validated by the installed SDK (auth.getClaims()) and bound to the user the auth server returned (same `sub`), carry OAuth
// authentication (`amr`) AND the account holds a matching, confirmed, Google-verified identity. A password, magic-link or recovery
// session on an account that merely HAS Google linked is `other`. The old code labelled every auth user `google`; it no longer does.
//
// `verifiedEmail`: the address this user has PROVEN to the auth server through Google (src/lib/identity/invitations.ts), and only on
// a proven Google session; null otherwise. It is read from the auth server's own answer, never from the request, and is used for
// one thing: an invitation is accepted only by its intended recipient. It is not authority and it is never stored.
export type IdentitySessionLookup = { session: IdentitySession | null; failed: boolean; verifiedEmail: string | null }

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
    // the staff row counts only when it is THIS auth user's row (an employee-code cookie next to someone else's Google session does not)
    const own = staff && staff.via === 'google' && staff.auth_user_id === user.id ? staff : null
    const staffFacts = own ? { id: own.id, role: own.role, badge: own.badge, branch_id: own.branch_id } : null
    const as = (via: 'google' | 'quick' | 'other', verifiedEmail: string | null = null): IdentitySessionLookup =>
      ({ session: { authUserId: user.id, via, full: via === 'google', staff: staffFacts }, failed: false, verifiedEmail })

    // The current session's claims, validated by the SDK (signature against the project's keys; for a symmetric key the SDK asks
    // the auth server). The auth server not answering is "could not check" (503); any other refusal means this session proves
    // nothing, so it is `other` (the person is offered a fresh Google sign-in), never access.
    let claims: SessionClaims | null = null
    try {
      const { data, error } = await supabase.auth.getClaims()
      if (error) {
        if (authFailed(error)) return { session: null, failed: true, verifiedEmail: null }
      } else {
        claims = (data?.claims as SessionClaims | undefined) ?? null
      }
    } catch {
      return { session: null, failed: true, verifiedEmail: null }
    }

    const proof = proveGoogleSession(claims, user)
    // a quick (six-digit) session is named as such; a failed lookup of the session kind is "could not check", never "full"
    if (proof.sessionId) {
      let quick: boolean
      try {
        quick = await isQuickSessionId(proof.sessionId)
      } catch {
        return { session: null, failed: true, verifiedEmail: null }
      }
      if (quick) return as('quick')
    }
    return proof.google ? as('google', proof.verifiedEmail) : as('other')
  }

  if (staff && staff.via === 'employee_code') {
    return { session: { authUserId: null, via: 'employee_code', full: false, staff: { id: staff.id, role: staff.role, badge: staff.badge, branch_id: staff.branch_id } }, failed: false, verifiedEmail: null }
  }
  return { session: null, failed: authFailed(authError), verifiedEmail: null }
})
