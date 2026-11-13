import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { INVITATION_COOKIE, isInvitationToken } from '@/lib/identity/invitations'
import { requireBenefitsUser } from '@/lib/identity/server/guard'
import { identityJson, throttleCredential } from '@/lib/identity/server/http'
import { invitationTokenDigest, recipientDigest } from '@/lib/identity/server/invitations'
import { peekInvitation } from '@/lib/identity/server/organizations'

// What the invitation page shows. A verified full Google sign-in first (requireBenefitsUser: 401 signed out, 403 for a code or
// quick session); only then is the database asked, and only the INTENDED recipient (the verified Google address, never a typed
// one) of an invitation that could be accepted right now sees which organization and department it is for.
//   none         no invitation token on this device
//   unverified   this account has no Google-verified address, so it can accept nothing
//   unavailable  one answer for: unknown, used, revoked, expired, meant for someone else, switched-off department, issuer without authority
//   ready        the names, and when it expires
export const GET = apiRoute(async (request: NextRequest) => {
  const actor = await requireBenefitsUser()
  const token = request.cookies.get(INVITATION_COOKIE)?.value
  if (!isInvitationToken(token)) return identityJson({ state: 'none' })
  if (!actor.verifiedEmail) return identityJson({ state: 'unverified' })
  await throttleCredential('invite-status', actor.authUserId, 40, 600)
  const invitation = await peekInvitation(invitationTokenDigest(token), actor.authUserId, recipientDigest(actor.verifiedEmail))
  if (!invitation) return identityJson({ state: 'unavailable' })
  return identityJson({ state: 'ready', ...invitation })
})
