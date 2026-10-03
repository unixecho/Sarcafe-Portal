import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, NotFound } from '@/lib/http/errors'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { resolveOrderIdByToken } from '@/lib/orders/customer'
import { loadOrderById } from '@/lib/orders/state-query'

// The one thing a customer's own phone can read with no session at all —
// gated by the opaque token alone (see lib/orders/customer.ts), never a
// cookie/login. Rate-limited per-IP purely for hygiene: the token's own
// 160 bits of entropy already makes guessing infeasible, this just keeps
// one runaway client from hammering the read path.
export const GET = apiRoute(async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
  const { token } = await context.params

  const ip = clientIp(request)
  if (!(await checkRateLimit(`order-status:${ip}`, 120, 300))) {
    return NextResponse.json({ error: { code: 'rate_limited', message: 'יותר מדי בקשות — נסו שוב בעוד רגע.' } }, { status: 429 })
  }

  const orderId = await resolveOrderIdByToken(token)
  if (!orderId) throw NotFound('הזמנה לא נמצאה, או שהקישור פג תוקף.')

  const order = await loadOrderById(orderId)
  if (!order) throw NotFound('הזמנה לא נמצאה.')

  // Customer-safe projection — drops the staff-only fields (who took the
  // order, any internal order-level note) that lib/orders/types.ts's
  // Order carries for the board but that were never meant for the
  // customer's own screen.
  const { createdByName: _createdByName, notes: _notes, ...customerSafe } = order
  return NextResponse.json({ order: customerSafe })
})
