import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiError } from '@/lib/http/errors'
import { parseBody } from '@/lib/pos/server/guard'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { EMPLOYEE_SESSION_COOKIE, resolveStaffIdentity } from '@/lib/staff/session'
import { credentialRoute, limitInvitation, newToken, ONBOARDING_HEADERS, setLinkCookie, tokenHash } from '@/lib/staff/invitations'
import { staffDisplayName } from '@/lib/shifts/names'

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('inspect'), token }).strict(),
  z.object({ action: z.literal('complete'), token, passcode: z.string().regex(/^\d{6}$/) }).strict(),
])
const invalid = () => new ApiError(410, 'invalid_invite', 'הקישור אינו זמין. בקשו מהמנהל/ת קישור חדש.')

export const GET = credentialRoute(async () => {
  const identity = await resolveStaffIdentity()
  if (!identity) throw new ApiError(401, 'unauthorized', 'יש להתחבר כדי לקשר Google לחשבון.')
  return NextResponse.json({ staff: { name: staffDisplayName(identity), employeeNo: identity.employee_no, hasGoogle: !!identity.auth_user_id } }, { headers: ONBOARDING_HEADERS })
})

export const POST = credentialRoute(async (request: NextRequest) => {
  const body = await parseBody(request, schema)
  await limitInvitation(request, body.action, body.token)
  const service = createServiceRoleClient()
  if (body.action === 'inspect') {
    const { data, error } = await service.rpc('staff_inspect_invitation', { p_token_hash: tokenHash(body.token) })
    if (error) throw new ApiError(503, 'unavailable', 'הגדרת החשבון אינה זמינה כרגע. נסו שוב בעוד רגע.')
    const result = data as { ok?: boolean; name?: string; employee_no?: number }
    if (!result?.ok) throw invalid()
    return NextResponse.json({ staff: { name: result.name, employeeNo: result.employee_no } }, { headers: ONBOARDING_HEADERS })
  }

  const sessionToken = newToken()
  const linkToken = newToken()
  const { data, error } = await service.rpc('staff_complete_invitation', {
    p_token_hash: tokenHash(body.token), p_pin: body.passcode, p_session_hash: tokenHash(sessionToken), p_link_hash: tokenHash(linkToken),
  })
  if (error) throw new ApiError(503, 'unavailable', 'לא הצלחנו להגדיר את החשבון. נסו שוב בעוד רגע.')
  const result = data as { ok?: boolean; reason?: string; name?: string; employee_no?: number; has_google?: boolean }
  if (!result?.ok) {
    if (result?.reason === 'weak_pin') throw new ApiError(400, 'weak_pin', 'בחרו קוד שקשה לנחש, בלי רצף או ספרות שחוזרות.')
    if (result?.reason === 'invalid_pin') throw new ApiError(400, 'invalid_pin', 'הקוד חייב להכיל בדיוק 6 ספרות.')
    throw invalid()
  }
  // Setup deliberately changes to this employee, even when a shared browser held Google cookies.
  await (await createServerSupabaseClient()).auth.signOut({ scope: 'local' })
  const response = NextResponse.json({ staff: { name: result.name, employeeNo: result.employee_no, hasGoogle: result.has_google }, ok: true }, { headers: ONBOARDING_HEADERS })
  response.cookies.set(EMPLOYEE_SESSION_COOKIE, sessionToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60,
  })
  setLinkCookie(response, linkToken)
  return response
})
