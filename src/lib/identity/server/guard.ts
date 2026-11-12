import 'server-only'

import { ApiError, BadRequest, Forbidden, Unauthorized } from '@/lib/http/errors'
import { authorizeIdentityAction } from '@/lib/identity/access'
import { identityAccessCheck } from '@/lib/identity/server/repository'
import { resolveIdentitySession } from '@/lib/identity/server/session'
import type { AccessOutcome, IdentityCapability, IdentityScope } from '@/lib/identity/types'

/**
 * The guard of every identity operation: a full sign-in, and this capability in this EXACT scope, decided by the database
 * (public.customer_access_check) for the auth user the server resolved. The scope is never optional and never read from "the
 * current business" of a cookie. Returns who passed and how; a route passes that outcome on to the repository.
 *
 * It does not replace or loosen any existing guard: requireOwner, requireStaffIdentity and the middleware decide the existing
 * routes exactly as before, and passing here opens none of them (an external administrator has no staff row).
 */
export async function requireIdentityAccess(capability: IdentityCapability, scope: IdentityScope): Promise<Extract<AccessOutcome, { ok: true }>> {
  const { session, failed } = await resolveIdentitySession()
  if (failed) throw new ApiError(503, 'unavailable', 'לא הצלחנו לבדוק את ההרשאה כרגע. נסו שוב בעוד רגע.')
  const outcome = await authorizeIdentityAction(session, { capability, scope }, identityAccessCheck)
  if (outcome.ok) return outcome
  switch (outcome.code) {
    case 'unauthenticated':
      throw Unauthorized()
    case 'quick_session':
      throw Forbidden('quick_session')
    case 'full_session_required':
      throw Forbidden('full_session_required')
    case 'bad_scope':
      throw BadRequest()
    case 'unavailable':
      throw new ApiError(503, 'unavailable', 'לא הצלחנו לבדוק את ההרשאה כרגע. נסו שוב בעוד רגע.')
    default:
      // one answer for "no such business / organization / department" and "not yours"
      throw Forbidden()
  }
}
