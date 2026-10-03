import { NextResponse, type NextRequest } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { resolveOrderIdByToken } from '@/lib/orders/customer'
import { sendTestNotification } from '@/lib/push/send'

// A customer-triggered self-check, called from NotificationPrimer's
// "granted" state — see lib/push/send.ts's header for why this exists:
// without it, "did enabling notifications actually work?" has no answer
// until a real order happens to reach Ready. Same public-write-path
// posture as subscribe/unsubscribe (same-origin, body cap, rate limit,
// token-gated — no session).

const MAX_BODY_BYTES = 512

function refuse(code: string, status: number) {
  return NextResponse.json({ error: { code, message: 'שגיאה בשליחת בדיקה.' } }, { status })
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
    if (!(await checkRateLimit(`order-test-notification:${ip}`, 10, 300))) return refuse('rate_limited', 429)

    const body = await request.json().catch(() => null)
    const token = typeof body?.token === 'string' ? body.token : ''

    const orderId = await resolveOrderIdByToken(token)
    if (!orderId) return refuse('not_found', 404)

    const result = await sendTestNotification(orderId)
    return NextResponse.json(result)
  } catch (err) {
    console.error('test-notification route error:', err)
    return refuse('server', 500)
  }
}
