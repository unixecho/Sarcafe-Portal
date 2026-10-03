import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError } from '@/lib/http/errors'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { parseBody, safeLogMessage } from '@/lib/pos/server/guard'
import { mintQuickSession } from '@/lib/pos/server/quick-login'

// POST /api/auth/quick-login — employee number + 6-digit passcode -> a real session as
// that person (blueprint §1a.5, migration 022). The OPTION for a shared station tablet;
// the default way in is still the person's own Google account.
//
// Trust model. There is no session yet — the caller is a stranger who may be guessing —
// so this route is built to be useless to a guesser:
//   * same-origin JSON only, strict body (parseBody);
//   * rate limits BEFORE any verification, per employee number AND per IP;
//   * ONE answer, identical in status and body, for every reason a login can fail
//     (wrong code, no such number, inactive, never signed in with Google, no code set);
//     pos_verify_pin burns comparable bcrypt time on every path, so the timing says
//     nothing either;
//   * the passcode and the request body are never logged or echoed;
//   * a failed mint leaves no cookie behind (mintQuickSession).
// The session it opens is second-class — see lib/pos/server/quick-login.ts.

const body = z
  .object({
    employeeNo: z.number().int().min(1).max(99999),
    passcode: z.string().regex(/^\d{6}$/),
  })
  .strict()

const GENERIC = 'מספר עובד או קוד שגויים'

const fail = () => new ApiError(401, 'unauthorized', GENERIC)

export const POST = apiRoute(async (request: NextRequest) => {
  const { employeeNo, passcode } = await parseBody(request, body)

  const [perPerson, perIp] = await Promise.all([
    checkRateLimit(`quick:emp:${employeeNo}`, 10, 900),
    checkRateLimit(`quick:ip:${clientIp(request)}`, 30, 900),
  ])
  if (!perPerson || !perIp) {
    throw new ApiError(429, 'rate_limited', 'יותר מדי ניסיונות. חכו כמה דקות ונסו שוב.')
  }

  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('pos_verify_pin', { p_employee_no: employeeNo, p_pin: passcode })
  if (error) {
    // The function name and SQLSTATE only: never the arguments.
    console.error('pos_verify_pin failed:', error.code, safeLogMessage(error.message))
    throw new ApiError(500, 'internal_error', 'משהו השתבש אצלנו, נסו שוב')
  }
  const verified = data as { ok?: boolean; staff_id?: string; email?: string } | null
  if (!verified || verified.ok !== true || !verified.staff_id || !verified.email) throw fail()

  try {
    await mintQuickSession({ id: verified.staff_id, email: verified.email })
  } catch {
    // The code was right but the session could not be opened. Not "wrong code" — the
    // person should know to use Google instead — and no cookie was left behind.
    console.error('quick login: session could not be opened')
    throw new ApiError(500, 'internal_error', 'לא הצלחנו לפתוח את הכניסה. נסו שוב או היכנסו עם Google.')
  }

  return NextResponse.json({ ok: true, next: '/pos' }, { headers: { 'Cache-Control': 'no-store' } })
})
