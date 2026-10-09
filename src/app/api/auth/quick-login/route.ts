import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError } from '@/lib/http/errors'
import { checkCredentialRateLimit, clientIp, credentialFingerprint } from '@/lib/rate-limit'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { parseBody, safeLogMessage } from '@/lib/pos/server/guard'
import { issueEmployeeSession, revokeEmployeeSession } from '@/lib/staff/session'
import { POS_RETURN_COOKIE, safePosReturn } from '@/lib/staff/navigation'

// Employee number + six-digit PIN opens an opaque, floor-only staff session.
// Google is optional for onboarding and required for scheduling and quick orders.
//
// Trust model. There is no session yet — the caller is a stranger who may be guessing —
// so this route is built to be useless to a guesser:
//   * same-origin JSON only, strict body (parseBody);
//   * rate limits BEFORE any verification, per employee number AND per IP;
//   * ONE answer, identical in status and body, for every reason a login can fail
//     (wrong code, no such number, inactive, no code set);
//     pos_verify_pin burns comparable bcrypt time on every path, so the timing says
//     nothing either;
//   * the passcode and the request body are never logged or echoed;
//   * the browser receives no Supabase Auth JWT from PIN login.

const body = z
  .object({
    employeeNo: z.union([z.string().regex(/^(?=.*[1-9])\d{1,5}$/), z.number().int().min(1).max(99999)]).transform(String),
    passcode: z.string().regex(/^\d{6}$/),
    next: z.enum(['/pos', '/staff', '/staff/checklists', '/staff/schedule']).optional(),
  })
  .strict()

const GENERIC = 'מספר עובד או קוד שגויים'

const fail = () => new ApiError(401, 'unauthorized', GENERIC)

export const POST = apiRoute(async (request: NextRequest) => {
  const { employeeNo, passcode, next = '/staff' } = await parseBody(request, body)
  const ipKey = credentialFingerprint(clientIp(request))
  const employeeKey = credentialFingerprint(String(employeeNo))

  const [perEmployeeWindow, perEmployeeDay, perIp, perPair] = await Promise.all([
    checkCredentialRateLimit(`quick:emp15:${employeeKey}`, 8, 900),
    checkCredentialRateLimit(`quick:emp24:${employeeKey}`, 40, 86_400),
    checkCredentialRateLimit(`quick:ip15:${ipKey}`, 20, 900),
    checkCredentialRateLimit(`quick:pair15:${ipKey}:${employeeKey}`, 5, 900),
  ])
  if (!perEmployeeWindow || !perEmployeeDay || !perIp || !perPair) {
    throw new ApiError(429, 'rate_limited', 'יותר מדי ניסיונות. חכו כמה דקות ונסו שוב.')
  }

  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('pos_verify_pin', { p_employee_no: employeeNo, p_pin: passcode })
  if (error) {
    // The function name and SQLSTATE only: never the arguments.
    console.error('pos_verify_pin failed:', error.code, safeLogMessage(error.message))
    throw new ApiError(500, 'internal_error', 'משהו השתבש אצלנו, נסו שוב')
  }
  const verified = data as { ok?: boolean; staff_id?: string; email?: string | null; auth_user_id?: string | null } | null
  if (!verified || verified.ok !== true || !verified.staff_id) {
    await new Promise((resolve) => setTimeout(resolve, 180 + Math.floor(Math.random() * 220)))
    throw fail()
  }

  const { data: access, error: accessError } = await service
    .from('staff')
    .select('role, badge')
    .eq('id', verified.staff_id)
    .eq('active', true)
    .maybeSingle()
  if (accessError || !access) throw fail()
  const destination = next === '/pos' ? safePosReturn(request.cookies.get(POS_RETURN_COOKIE)?.value) || '/pos' : next === '/staff/schedule' ? '/staff' : next

  const response = NextResponse.json({ ok: true, next: destination }, { headers: { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' } })
  response.cookies.set(POS_RETURN_COOKIE, '', { path: '/', maxAge: 0 })
  try {
    // A PIN never creates an Auth JWT, even for a Google-linked employee. Clear
    // the previous tablet user's browser session before switching identities.
    const supabase = await createServerSupabaseClient()
    const { error: signoutError } = await supabase.auth.signOut({ scope: 'local' })
    if (signoutError && signoutError.name !== 'AuthSessionMissingError') throw signoutError
    await revokeEmployeeSession(response)
    await issueEmployeeSession(response, verified.staff_id)
  } catch {
    console.error('quick login: employee session could not be opened')
    throw new ApiError(500, 'internal_error', 'לא הצלחנו לפתוח את הכניסה. נסו שוב.')
  }
  return response
})
