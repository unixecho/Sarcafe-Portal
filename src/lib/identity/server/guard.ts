import 'server-only'

import { ApiError, BadRequest, Forbidden, Unauthorized } from '@/lib/http/errors'
import { authorizeIdentityAction } from '@/lib/identity/access'
import { isUuid } from '@/lib/identity/rules'
import { identityManageCheck, identityUnavailable } from '@/lib/identity/server/organizations'
import { findActiveBusinessBySlug, identityAccessCheck } from '@/lib/identity/server/repository'
import { requireOwner } from '@/lib/owner/guard'
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

// ---------------------------------------------------------------- FABLE-002: the two route families

/** Who is acting, as the server resolved it. `verifiedEmail` is only ever compared with an invitation's intended recipient. */
export type IdentityActor = { authUserId: string; verifiedEmail: string | null }

/** The business the owner pages stand for. A constant of this deployment, never a value from a request, a cookie or a session. */
export const OWNER_BUSINESS_SLUG = 'sarcafe'

/**
 * /owner/members and /api/owner/members/*: a FULL owner session (the existing owner guard, unchanged: not a quick code session,
 * not a general manager, not an employee) AND business_admin on the Sarcafe business, decided by the database. Being an owner is
 * not enough by itself and opens nothing else: what this actor may do inside an organization is decided again, per call, by the
 * customer_* function (an organization administrator, or setup while the organization has none).
 * 503 when the identity tables are not there yet or cannot be asked (never access, never "sign in again").
 */
export async function requireOwnerBusiness(): Promise<IdentityActor & { businessId: string }> {
  await requireOwner()
  let business: { id: string } | null
  try {
    business = await findActiveBusinessBySlug(OWNER_BUSINESS_SLUG)
  } catch {
    throw identityUnavailable()
  }
  if (!business) throw identityUnavailable()
  const outcome = await requireIdentityAccess('business_admin', { kind: 'business', businessId: business.id })
  const { verifiedEmail } = await resolveIdentitySession()
  return { authUserId: outcome.authUserId, verifiedEmail, businessId: business.id }
}

/**
 * /benefits/* and /api/benefits/*: a verified auth user on a full Google sign-in. No staff row is needed and none is created; this
 * says who is asking and gives no authority at all (an organization administrator and a department head are found by their
 * grants, per call). An employee-code session and a quick (six-digit) session are refused.
 */
export async function requireBenefitsUser(): Promise<IdentityActor> {
  const { session, failed, verifiedEmail } = await resolveIdentitySession()
  if (failed) throw identityUnavailable()
  if (!session) throw Unauthorized()
  if (session.via !== 'google' || !session.authUserId) throw Forbidden('full_session_required')
  if (!session.full) throw Forbidden('quick_session')
  return { authUserId: session.authUserId, verifiedEmail }
}

/**
 * /api/benefits/manage/organizations/[organizationId]/*: an ORGANIZATION ADMINISTRATOR of exactly this organization (a live grant,
 * asked from the database on every call). A department head, an administrator of another organization, a business owner in
 * setup and anyone else get the same 403; an owner uses the owner pages. The function behind the call rechecks the actor again.
 */
export async function requireOrganizationAdmin(organizationId: string): Promise<IdentityActor> {
  const actor = await requireBenefitsUser()
  if (!isUuid(organizationId)) throw BadRequest()
  const check = await identityManageCheck(actor.authUserId, organizationId, true)
  if (!check.ok || check.via !== 'organization_admin') throw Forbidden()
  return actor
}
