import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiError } from '@/lib/http/errors'
import { parseBody } from '@/lib/pos/server/guard'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { EMPLOYEE_SESSION_COOKIE, resolveStaffIdentity } from '@/lib/staff/session'
import { credentialRoute, limitInvitation, newToken, ONBOARDING_HEADERS, setLinkCookie, tokenHash } from '@/lib/staff/invitations'
import { staffDisplayName } from '@/lib/shifts/names'

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const subscription = z
  .object({
    endpoint: z.string().url().max(1000).refine((value) => value.startsWith('https://'), 'push endpoints are https'),
    keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(8).max(100) }).strict(),
  })
  .passthrough() // PushSubscription.toJSON() also carries expirationTime
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('inspect'), token }).strict(),
  z.object({ action: z.literal('complete'), token, passcode: z.string().regex(/^\d{6}$/) }).strict(),
  // The wizard's FIRST step (the notifications gate) runs before the personal code exists: the invite link is the identity.
  z.object({ action: z.literal('push'), token, subscription }).strict(),
  z.object({ action: z.literal('push_status'), token, endpoint: z.string().url().max(1000) }).strict(),
  // The person saw the tour (or left it): the walk is finished. Needs the session the code created.
  z.object({ action: z.literal('finish') }).strict(),
])
const invalid = () => new ApiError(410, 'invalid_invite', 'הקישור אינו זמין. בקשו מהמנהל/ת קישור חדש.')
const unavailable = () => new ApiError(503, 'unavailable', 'הגדרת החשבון אינה זמינה כרגע. נסו שוב בעוד רגע.')

type Service = ReturnType<typeof createServiceRoleClient>

/** The person a live invite link belongs to (not expired, not used, not revoked). Anything else is the one "not available" answer. */
async function staffOfInvite(service: Service, linkToken: string): Promise<string> {
  const hash = tokenHash(linkToken)
  const { data, error } = await service.rpc('staff_inspect_invitation', { p_token_hash: hash })
  if (error) throw unavailable()
  if (!(data as { ok?: boolean } | null)?.ok) throw invalid()
  const { data: invitation } = await service.from('staff_invitations').select('staff_id').eq('token_hash', hash).maybeSingle()
  if (!invitation) throw invalid()
  return invitation.staff_id as string
}

export const GET = credentialRoute(async () => {
  const identity = await resolveStaffIdentity()
  if (!identity) throw new ApiError(401, 'unauthorized', 'יש להתחבר כדי לקשר Google לחשבון.')
  // Tolerant on purpose: if the progress column is not there (a database that has not had the migration), the person is treated as done.
  const { data: mine } = await createServiceRoleClient().from('staff').select('avatar_emoji, onboarding_done_at').eq('id', identity.id).maybeSingle()
  const done = mine ? (mine as { onboarding_done_at?: string | null }).onboarding_done_at !== null || !('onboarding_done_at' in mine) : true
  return NextResponse.json({ staff: { name: staffDisplayName(identity), firstName: identity.first_name, lastName: identity.last_name, employeeNo: identity.employee_no, hasGoogle: !!identity.auth_user_id, emoji: (mine?.avatar_emoji as string | null) ?? null, onboardingDone: done } }, { headers: ONBOARDING_HEADERS })
})

export const POST = credentialRoute(async (request: NextRequest) => {
  const body = await parseBody(request, schema)
  const service = createServiceRoleClient()

  if (body.action === 'finish') {
    const identity = await resolveStaffIdentity()
    if (!identity) throw new ApiError(401, 'unauthorized', 'יש להתחבר כדי לסיים.')
    const { error } = await service.from('staff').update({ onboarding_done_at: new Date().toISOString() }).eq('id', identity.id)
    // A database without the column simply has nothing to remember: the person is never sent back to the walk.
    if (error && error.code !== '42703') throw new ApiError(503, 'unavailable', 'לא הצלחנו לשמור. נסו שוב.')
    return NextResponse.json({ ok: true }, { headers: ONBOARDING_HEADERS })
  }

  // The status check runs on every focus of the gate, so it has a wider allowance than the credential steps.
  if (body.action === 'push_status') await limitInvitation(request, 'pushcheck', body.token, { ip: 240, target: 120 })
  else await limitInvitation(request, body.action, body.token)

  if (body.action === 'push') {
    const staffId = await staffOfInvite(service, body.token)
    // endpoint is unique: if another person used this phone before, the row moves to this person (same rule as /api/staff/push).
    const { error } = await service.from('staff_push_subscriptions').upsert(
      {
        staff_id: staffId,
        endpoint: body.subscription.endpoint,
        p256dh: body.subscription.keys.p256dh,
        auth: body.subscription.keys.auth,
        user_agent: (request.headers.get('user-agent') ?? '').slice(0, 200) || null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    )
    if (error) throw new ApiError(503, 'unavailable', 'לא הצלחנו להפעיל התראות. נסו שוב.')
    return NextResponse.json({ ok: true }, { headers: ONBOARDING_HEADERS })
  }

  if (body.action === 'push_status') {
    const staffId = await staffOfInvite(service, body.token)
    const { data, error } = await service.from('staff_push_subscriptions').select('id').eq('staff_id', staffId).eq('endpoint', body.endpoint).maybeSingle()
    if (error) throw new ApiError(503, 'unavailable', 'לא הצלחנו לבדוק את ההתראות.')
    return NextResponse.json({ subscribed: !!data }, { headers: ONBOARDING_HEADERS })
  }

  if (body.action === 'inspect') {
    const { data, error } = await service.rpc('staff_inspect_invitation', { p_token_hash: tokenHash(body.token) })
    if (error) throw unavailable()
    const result = data as { ok?: boolean; name?: string; employee_no?: number }
    if (!result?.ok) throw invalid()
    const hash = tokenHash(body.token)
    const { data: invitation } = await service.from('staff_invitations').select('staff_id').eq('token_hash', hash).maybeSingle()
    const { data: person } = invitation ? await service.from('staff').select('employee_code, employee_no').eq('id', invitation.staff_id).maybeSingle() : { data: null }
    const employeeNo = person?.employee_code ?? (person?.employee_no == null ? String(result.employee_no ?? '') : String(person.employee_no))
    return NextResponse.json({ staff: { name: result.name, employeeNo } }, { headers: ONBOARDING_HEADERS })
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
  const { data: createdSession } = await service.from('staff_employee_sessions').select('staff_id').eq('token_hash', tokenHash(sessionToken)).maybeSingle()
  const { data: person } = createdSession ? await service.from('staff').select('employee_code, employee_no, first_name, last_name, avatar_emoji').eq('id', createdSession.staff_id).maybeSingle() : { data: null }
  const employeeNo = person?.employee_code ?? (person?.employee_no == null ? String(result.employee_no ?? '') : String(person.employee_no))
  const response = NextResponse.json({ staff: { name: result.name, firstName: person?.first_name ?? null, lastName: person?.last_name ?? null, emoji: person?.avatar_emoji ?? null, employeeNo, hasGoogle: result.has_google }, ok: true }, { headers: ONBOARDING_HEADERS })
  response.cookies.set(EMPLOYEE_SESSION_COOKIE, sessionToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60,
  })
  setLinkCookie(response, linkToken)
  return response
})
