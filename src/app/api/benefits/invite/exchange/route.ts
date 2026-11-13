import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest } from '@/lib/http/errors'
import { INVITATION_COOKIE, INVITATION_COOKIE_MAX_AGE, INVITATION_COOKIE_PATH, isInvitationToken } from '@/lib/identity/invitations'
import { assertSameOrigin, identityJson, readIdentityBody, throttleCredential } from '@/lib/identity/server/http'
import { clientIp } from '@/lib/rate-limit'

// The invitation link carries its token in the URL fragment, which a browser never sends to a server. The invitation page posts it
// here once and removes it from the address bar; from then on the token lives only in an HttpOnly cookie that is sent to
// /api/benefits/invite and nowhere else. PUBLIC on purpose (the recipient is not signed in yet), and it says NOTHING about the
// invitation: any well-formed token gets the same answer, the database is not asked, and whether the invitation exists, is open or
// is meant for this person is decided only after a verified sign-in (status / accept). Same-origin, strict body, and a credential
// rate limit that fails closed.

const cookie = (value: string, maxAge: number) => ({
  name: INVITATION_COOKIE, value, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: INVITATION_COOKIE_PATH, maxAge,
})

export const POST = apiRoute(async (request: NextRequest) => {
  const body = await readIdentityBody(request, z.object({ token: z.string().max(80) }).strict())
  await throttleCredential('invite-exchange', clientIp(request), 20, 600)
  if (!isInvitationToken(body.token)) throw BadRequest()
  const response = identityJson({ ok: true })
  response.cookies.set(cookie(body.token, INVITATION_COOKIE_MAX_AGE))
  return response
})

/** "Not now": forget the token on this device. */
export const DELETE = apiRoute(async (request: NextRequest) => {
  assertSameOrigin(request)
  const response = identityJson({ ok: true })
  response.cookies.set(cookie('', 0))
  return response
})
