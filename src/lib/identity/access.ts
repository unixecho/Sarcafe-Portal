// The one decision every identity operation starts with: may THIS session use THIS capability in THIS exact scope?
// Pure (the database question is passed in), so the QA suite runs it against the real SQL function with every kind of session.
import { accessCheckArgs, capabilityFitsScope, hasFullIdentitySession, isCapability, isLegacyOwnerSession, normalizeScope } from '@/lib/identity/rules'
import type { AccessCheck, AccessOutcome, IdentitySession } from '@/lib/identity/types'

const refuse = (status: 400 | 401 | 403 | 503, code: Extract<AccessOutcome, { ok: false }>['code']): AccessOutcome => ({ ok: false, status, code })

/**
 * Order matters: the cheap refusals come first, and the database is asked only by a verified, fully signed-in user with a
 * well-formed question. Anything unexpected (the database not answering, an answer of an unknown shape) is a refusal, never access.
 *
 * - nobody signed in → 401 `unauthenticated`
 * - an employee-code session (no auth user behind it) → 403 `full_session_required`
 * - a quick (six-digit) Google session → 403 `quick_session`
 * - a scope that is not exactly one business / organization / department, or a capability asked outside its scope → 400 `bad_scope`
 * - the database refuses (no grant, revoked, expired, another business or organization, a target that does not exist) → 403 `denied`
 * - the database could not be asked → 503 `unavailable`
 */
export async function authorizeIdentityAction(
  session: IdentitySession | null | undefined,
  request: { capability: unknown; scope: unknown },
  check: AccessCheck,
): Promise<AccessOutcome> {
  if (!session) return refuse(401, 'unauthenticated')
  if (session.via !== 'google' || !session.authUserId) return refuse(403, 'full_session_required')
  if (!session.full) return refuse(403, 'quick_session')
  if (!hasFullIdentitySession(session)) return refuse(403, 'full_session_required')

  const scope = normalizeScope(request.scope)
  if (!scope || !isCapability(request.capability) || !capabilityFitsScope(request.capability, scope)) return refuse(400, 'bad_scope')
  const capability = request.capability

  let answer: Awaited<ReturnType<AccessCheck>>
  try {
    answer = await check(accessCheckArgs(session.authUserId, capability, scope))
  } catch {
    return refuse(503, 'unavailable')
  }
  if (!answer || typeof answer !== 'object') return refuse(503, 'unavailable')
  if (answer.ok !== true) return answer.error === 'bad_request' ? refuse(400, 'bad_scope') : refuse(403, 'denied')

  if (answer.via === 'legacy_owner') {
    // the database found an owner row for this auth user; the session must say the same, and only a business can be reached this way
    if (scope.kind !== 'business' || capability !== 'business_admin' || !isLegacyOwnerSession(session) || !answer.staff_id) return refuse(403, 'denied')
    return { ok: true, via: 'legacy_owner', authUserId: session.authUserId, capability, scope, grantId: null, principalId: null, staffId: answer.staff_id }
  }
  if (answer.via === 'grant' && answer.grant_id && answer.principal_id) {
    return { ok: true, via: 'grant', authUserId: session.authUserId, capability, scope, grantId: answer.grant_id, principalId: answer.principal_id, staffId: null }
  }
  return refuse(403, 'denied')
}
