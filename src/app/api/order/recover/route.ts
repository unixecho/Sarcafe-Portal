import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'

// Recovery-code entry — the fallback when a customer's QR/link is gone
// (closed the tab, cleared history, printer smudged the code). Same
// public-write-path posture as /api/feedback: same-origin + Content-Type
// check (closes the simple-request CSRF hole), a body-size ceiling, and
// rate limiting — here the REAL defense (see migration 018's header: a
// 6-digit code is brute-forceable against any hash given enough
// unthrottled guesses, so the throttle IS the security, not the hash).
//
// A correct code issues a FRESH token (rotation, migration 018's
// issue_order_access()) rather than ever handing back anything derived
// from the stored hash — there is nothing to hand back; only the hash
// exists server-side. Wrong code and expired code get the exact same
// generic error, on purpose.

const MAX_BODY_BYTES = 1_024
const RATE_MAX = 8
const RATE_WINDOW_SECONDS = 15 * 60
const CODE_PATTERN = /^\d{6}$/

function refuse(code: string, status: number) {
  return NextResponse.json({ error: { code, message: GENERIC_MESSAGES[code] ?? 'שגיאה.' } }, { status })
}

const GENERIC_MESSAGES: Record<string, string> = {
  bad_request: 'קוד לא תקין.',
  rate_limited: 'יותר מדי ניסיונות — נסו שוב בעוד כמה דקות.',
  invalid_code: 'הקוד שגוי או שפג תוקפו.',
  server: 'שגיאה. נסו שוב.',
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin')
    if (origin) {
      let originHost: string | null = null
      try {
        originHost = new URL(origin).host
      } catch {
        originHost = null
      }
      const host = request.headers.get('host')
      if (!originHost || !host || originHost !== host) return refuse('bad_request', 403)
    }

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('application/json')) return refuse('bad_request', 415)

    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return refuse('bad_request', 413)

    const ip = clientIp(request)
    if (!(await checkRateLimit(`order-recover:${ip}`, RATE_MAX, RATE_WINDOW_SECONDS))) {
      return refuse('rate_limited', 429)
    }

    const body = await request.json().catch(() => null)
    const recoveryCode = typeof body?.recoveryCode === 'string' ? body.recoveryCode.trim() : ''
    if (!CODE_PATTERN.test(recoveryCode)) return refuse('bad_request', 400)

    const service = createServiceRoleClient()

    const { data: orderId, error: verifyError } = await service.rpc('verify_order_recovery_code', {
      p_recovery_code: recoveryCode,
    })
    if (verifyError) {
      console.error('verify_order_recovery_code failed:', verifyError.message)
      return refuse('server', 500)
    }
    if (!orderId) return refuse('invalid_code', 404)

    const { data: access, error: issueError } = await service.rpc('issue_order_access', { p_order_id: orderId })
    if (issueError || !access?.[0]) {
      console.error('issue_order_access failed:', issueError?.message)
      return refuse('server', 500)
    }

    return NextResponse.json({ token: access[0].token as string })
  } catch (err) {
    console.error('order recover route error:', err)
    return refuse('server', 500)
  }
}
