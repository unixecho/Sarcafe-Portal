// Server-only Web Push sender. The real "ready" notification fires
// exactly once per order lifecycle — on the READY transition, per
// SARCafe-ARCHITECTURE-AUDIT.md §7's own scoping ("Triggered server-side
// on the READY transition only") — never on new/preparing/completed, to
// avoid notification fatigue over a single short order. sendTestNotification
// is the one deliberate exception: a customer-triggered self-check so
// "did enabling notifications actually work?" has an answer that doesn't
// depend on waiting for a real order to reach Ready.
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
//  - Callers in a Route Handler MUST schedule notifyOrderReady() via
//    next/server's after(), never a bare `void` call — a serverless
//    function can be frozen the instant its response is sent, and this
//    does a real DB round trip plus an HTTP call to the push service,
//    both slower than the response it's riding on. A fire-and-forget
//    call here was a real production bug: it looked like it worked
//    (the subscription existed, permission was granted) but the send
//    itself kept getting cut off mid-flight.

import webpush from 'web-push'
import { createServiceRoleClient } from '@/lib/supabase/server'

let vapidReady: boolean | null = null

function ensureVapidConfigured(): boolean {
  if (vapidReady !== null) return vapidReady

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT

  if (!publicKey || !privateKey || !subject) {
    console.error('Web Push not configured (missing VAPID env vars) — skipping send.')
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

async function loadSubscriptions(service: ReturnType<typeof createServiceRoleClient>, orderId: string): Promise<SubscriptionRow[]> {
  const { data } = await service.from('order_push_subscriptions').select('id, endpoint, p256dh, auth, page_url').eq('order_id', orderId)
  return (data as SubscriptionRow[] | null) ?? []
}

export async function notifyOrderReady(orderId: string, orderNumber: number): Promise<void> {
  try {
    if (!ensureVapidConfigured()) return

    const service = createServiceRoleClient()
    const rows = await loadSubscriptions(service, orderId)
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

export type TestNotificationResult = {
  configured: boolean
  subscriptions: number
  sent: number
  /** The first failure's detail, verbatim from the push service — surfaced
   *  all the way to the customer's screen on purpose. There is no server
   *  log this session can read, so "sent: 0" alone would be a dead end;
   *  the raw statusCode/body (e.g. a VAPID key mismatch, a expired
   *  subscription) is the one thing that actually lets a failure get
   *  diagnosed from a screenshot. */
  error: { statusCode: number | null; detail: string } | null
}

/** Customer-triggered self-check ("שליחת התראת בדיקה" in NotificationPrimer) —
 *  answers "does this browser actually have a working push subscription"
 *  immediately, instead of the customer having to wait for a real order
 *  to reach Ready to find out enabling notifications didn't stick. */
export async function sendTestNotification(orderId: string): Promise<TestNotificationResult> {
  if (!ensureVapidConfigured()) {
    return { configured: false, subscriptions: 0, sent: 0, error: { statusCode: null, detail: 'VAPID env vars missing or invalid on the server.' } }
  }

  const service = createServiceRoleClient()
  const rows = await loadSubscriptions(service, orderId)
  if (rows.length === 0) return { configured: true, subscriptions: 0, sent: 0, error: null }

  const results = await Promise.all(
    rows.map((row) =>
      sendToOne(
        service,
        row,
        JSON.stringify({
          title: 'בדיקת התראות ✓',
          body: 'אם קיבלתם את זה — ההתראות עובדות! נעדכן אתכם כשההזמנה תהיה מוכנה.',
          orderId,
          url: row.page_url,
        })
      )
    )
  )
  const sent = results.filter((r) => r.ok).length
  const firstFailure = results.find((r) => !r.ok)
  return {
    configured: true,
    subscriptions: rows.length,
    sent,
    error: firstFailure ? { statusCode: firstFailure.statusCode, detail: firstFailure.detail } : null,
  }
}

type SendOutcome = { ok: boolean; statusCode: number | null; detail: string }

async function sendToOne(service: ReturnType<typeof createServiceRoleClient>, row: SubscriptionRow, payload: string): Promise<SendOutcome> {
  try {
    await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, {
      urgency: 'high',
      TTL: 60 * 60 * 6, // 6h — no point delivering "ready" long after a truck's line has moved on
    })
    return { ok: true, statusCode: null, detail: '' }
  } catch (err) {
    const webPushErr = err as { statusCode?: number; body?: string; message?: string } | null
    const statusCode = webPushErr?.statusCode ?? null
    const detail = webPushErr?.body || webPushErr?.message || String(err)
    if (statusCode === 404 || statusCode === 410) {
      await service.from('order_push_subscriptions').delete().eq('id', row.id)
    } else {
      console.error('Push send failed:', statusCode, detail)
    }
    return { ok: false, statusCode, detail }
  }
}
