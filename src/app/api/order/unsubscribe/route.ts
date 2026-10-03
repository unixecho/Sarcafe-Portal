import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { resolveOrderIdByToken } from '@/lib/orders/customer'

// Mirrors subscribe/route.ts — called when a customer explicitly turns
// notifications back off, or when the browser reports its own
// subscription as expired (pushManager.getSubscription() returning null
// after having one before).

const MAX_BODY_BYTES = 2_048

function refuse(code: string, status: number) {
  return NextResponse.json({ error: { code, message: 'שגיאה.' } }, { status })
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
    if (!(await checkRateLimit(`order-unsubscribe:${ip}`, 20, 300))) return refuse('rate_limited', 429)

    const body = await request.json().catch(() => null)
    const token = typeof body?.token === 'string' ? body.token : ''
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
    if (!endpoint) return refuse('bad_request', 400)

    const orderId = await resolveOrderIdByToken(token)
    if (!orderId) return refuse('not_found', 404)

    const service = createServiceRoleClient()
    await service.from('order_push_subscriptions').delete().eq('order_id', orderId).eq('endpoint', endpoint)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('order unsubscribe route error:', err)
    return refuse('server', 500)
  }
}
