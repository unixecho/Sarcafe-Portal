// Server-only Web Push sender. Fires exactly once per order lifecycle —
// on the READY transition, per SARCafe-ARCHITECTURE-AUDIT.md §7's own
// scoping ("Triggered server-side on the READY transition only") — never
// on new/preparing/completed, to avoid notification fatigue over a single
// short order.
//
// BULLETPROOF POSTURE:
//  - Every call is wrapped so a push failure (missing VAPID config, the
//    push service being down, a malformed subscription) can NEVER fail
//    the order-status transition it's reporting on — same rule
//    broadcastOrdersUpdated() already follows for the realtime nudge.
//  - A 404/410 from the push service means that specific subscription is
//    permanently gone (browser data cleared, permission revoked, etc.) —
//    deleted immediately rather than retried forever.
//  - Every subscription for the order gets its own independent
//    try/catch: one dead endpoint must never stop the others (a
//    household sharing one order might have two phones subscribed).

import webpush from 'web-push'
import { createServiceRoleClient } from '@/lib/supabase/server'

let vapidReady: boolean | null = null

function ensureVapidConfigured(): boolean {
  if (vapidReady !== null) return vapidReady

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT

  if (!publicKey || !privateKey || !subject) {
    console.error('Web Push not configured (missing VAPID env vars) — skipping notifyOrderReady.')
    vapidReady = false
    return false
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    vapidReady = true
  } catch (err) {
    console.error('Invalid VAPID configuration:', err instanceof Error ? err.message : err)
    vapidReady = false
  }
  return vapidReady
}

type SubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string; page_url: string }

export async function notifyOrderReady(orderId: string, orderNumber: number): Promise<void> {
  try {
    if (!ensureVapidConfigured()) return

    const service = createServiceRoleClient()
    const { data: subs } = await service
      .from('order_push_subscriptions')
      .select('id, endpoint, p256dh, auth, page_url')
      .eq('order_id', orderId)

    const rows = (subs as SubscriptionRow[] | null) ?? []
    if (rows.length === 0) return

    // Built per-subscription (not once, shared) because `url` comes from
    // each row's own stored page_url — see migration 018's header on why
    // the server can't reconstruct a token-bearing URL any other way.
    await Promise.all(
      rows.map((row) =>
        sendToOne(
          service,
          row,
          JSON.stringify({
            title: 'ההזמנה שלכם מוכנה! ☕',
            body: `הזמנה #${orderNumber} מחכה לכם בדלפק.`,
            orderId,
            url: row.page_url,
          })
        )
      )
    )
  } catch (err) {
    console.error('notifyOrderReady failed:', err instanceof Error ? err.message : err)
  }
}

async function sendToOne(
  service: ReturnType<typeof createServiceRoleClient>,
  row: SubscriptionRow,
  payload: string
): Promise<void> {
  try {
    await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, {
      urgency: 'high',
      TTL: 60 * 60 * 6, // 6h — no point delivering "ready" long after a truck's line has moved on
    })
  } catch (err) {
    const statusCode = (err as { statusCode?: number } | null)?.statusCode
    if (statusCode === 404 || statusCode === 410) {
      await service.from('order_push_subscriptions').delete().eq('id', row.id)
    } else {
      console.error('Push send failed:', statusCode, err instanceof Error ? err.message : err)
    }
  }
}
