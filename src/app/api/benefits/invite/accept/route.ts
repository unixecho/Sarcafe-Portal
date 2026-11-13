import type { NextRequest } from 'next/server'
import { ApiError, apiRoute, Forbidden } from '@/lib/http/errors'
import { INVITATION_COOKIE, INVITATION_COOKIE_PATH, isInvitationToken } from '@/lib/identity/invitations'
import { requireBenefitsUser } from '@/lib/identity/server/guard'
import { assertSameOrigin, identityJson, throttleCredential } from '@/lib/identity/server/http'
import { invitationTokenDigest, recipientDigest } from '@/lib/identity/server/invitations'
import { acceptInvitation } from '@/lib/identity/server/organizations'

// Accepting a department-head invitation. A verified full Google sign-in (requireBenefitsUser), from our own origin, with the
// token from the HttpOnly cookie (never from the body or the URL) and the recipient taken from the auth server's answer (never
// typed). The database does the rest in ONE transaction, once: recipient, expiry, revocation, issuer authority, the principal, the
// grant, the audit. The body is ignored: nothing a browser sends can choose the department, the role or the person.
// The credential rate limit fails closed: when it cannot be checked nothing is consumed.
const forget = { name: INVITATION_COOKIE, value: '', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: INVITATION_COOKIE_PATH, maxAge: 0 }

export const POST = apiRoute(async (request: NextRequest) => {
  assertSameOrigin(request)
  const actor = await requireBenefitsUser()
  const token = request.cookies.get(INVITATION_COOKIE)?.value
  // one refusal for every reason an invitation cannot be accepted
  const unavailable = () => {
    const response = identityJson({ error: { code: 'invitation_unavailable', message: 'ההזמנה אינה זמינה לחשבון הזה.' } }, 403)
    response.cookies.set(forget)
    return response
  }
  if (!isInvitationToken(token)) return unavailable()
  if (!actor.verifiedEmail) throw Forbidden('unverified')
  await throttleCredential('invite-accept', actor.authUserId, 10, 600)

  let accepted: Awaited<ReturnType<typeof acceptInvitation>>
  try {
    accepted = await acceptInvitation(invitationTokenDigest(token), actor.authUserId, recipientDigest(actor.verifiedEmail))
  } catch (error) {
    // the database could not be asked: the invitation is untouched and the token stays, so the person can try again
    if (error instanceof ApiError) throw error
    throw new ApiError(503, 'unavailable', 'לא הצלחנו לאשר כרגע. נסו שוב בעוד רגע.')
  }
  if (!accepted) return unavailable()
  const response = identityJson({ ok: true, organizationId: accepted.organizationId, departmentId: accepted.departmentId })
  response.cookies.set(forget)
  return response
})
