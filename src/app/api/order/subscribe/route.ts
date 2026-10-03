import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { resolveOrderIdByToken } from '@/lib/orders/customer'

// Saves a customer's browser push subscription against their order —
// called once, right after NotificationPrimer gets a granted permission
// and a PushSubscription from the service worker. Token-gated the same
// way the status read is (no session, no cookie): whoever holds the
// token can subscribe THAT order's own updates to THEIR OWN browser,
// which is exactly the capability this is meant to grant.
//
// `pageUrl` is stored (not derived later) because by the time a push
// actually fires, only its hash survives server-side — see migration
// 018's header. Restricted to this app's own /order/<token> shape so a
// crafted payload can't turn a future push's notificationclick into an
// open redirect.

const MAX_BODY_BYTES = 4_096
const PAGE_URL_PATTERN = /^\/order\/[0-9a-f]{40}$/

function refuse(code: string, status: number) {
  return NextResponse.json({ error: { code, message: 'שגיאה בהפעלת ההתראות.' } }, { status })
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
    if (!(await checkRateLimit(`order-subscribe:${ip}`, 20, 300))) return refuse('rate_limited', 429)

    const body = await request.json().catch(() => null)
    const token = typeof body?.token === 'string' ? body.token : ''
    const pageUrl = typeof body?.pageUrl === 'string' ? body.pageUrl : ''
    const sub = body?.subscription

    if (!PAGE_URL_PATTERN.test(pageUrl)) return refuse('bad_request', 400)
    if (
      !sub ||
      typeof sub.endpoint !== 'string' ||
      !sub.endpoint ||
      typeof sub.keys?.p256dh !== 'string' ||
      typeof sub.keys?.auth !== 'string'
    ) {
      return refuse('bad_request', 400)
    }

    const orderId = await resolveOrderIdByToken(token)
    if (!orderId) return refuse('not_found', 404)

    const service = createServiceRoleClient()
    const { error } = await service.from('order_push_subscriptions').upsert(
      {
        order_id: orderId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        page_url: pageUrl,
      },
      { onConflict: 'order_id,endpoint' }
    )
    if (error) {
      console.error('order subscribe insert failed:', error.message)
      return refuse('server', 500)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('order subscribe route error:', err)
    return refuse('server', 500)
  }
}
