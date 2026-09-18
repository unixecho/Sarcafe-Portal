// Server-side "nudge" so the order board refetches instantly instead of
// waiting for its polling fallback — same broadcast-not-subscribe shape
// as lib/menu/realtime.ts, and the same reasoning: a short-lived Route
// Handler shouldn't open a websocket handshake just to send one message.
// Keyed by branch SLUG, same convention as the menu channel, so the
// client provider never has to juggle id-vs-slug — it already has the
// slug from its own props before the first board fetch resolves anything.
//
// Payload carries no order content, just a timestamp — every subscriber
// re-fetches through its own authorized read path (/api/orders/state).

const EVENT = 'orders-updated'
const STATUS_EVENT = 'order-status-updated'

export function orderChannelName(branchSlug: string): string {
  return `orders:${branchSlug}`
}

/** A single order's own channel — what the CUSTOMER's tracking page
 *  subscribes to (never the branch-wide channel above, which would leak
 *  "some other order at this branch just changed" as a wake-up signal to
 *  every visitor, harmless in content but needless). */
export function orderStatusChannelName(orderId: string): string {
  return `order-status:${orderId}`
}

export const ORDERS_UPDATED_EVENT = EVENT
export const ORDER_STATUS_UPDATED_EVENT = STATUS_EVENT

async function broadcast(topic: string, event: string): Promise<void> {
  try {
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ messages: [{ topic, event, payload: { at: Date.now() } }] }),
    })
  } catch {
    // Best-effort — a failed nudge just means the board/customer page
    // falls back to its existing poll interval. A realtime hiccup must
    // never fail the order write it's reporting on.
  }
}

export function broadcastOrdersUpdated(branchSlug: string): Promise<void> {
  return broadcast(orderChannelName(branchSlug), EVENT)
}

export function broadcastOrderStatusChanged(orderId: string): Promise<void> {
  return broadcast(orderStatusChannelName(orderId), STATUS_EVENT)
}
