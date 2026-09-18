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

export function orderChannelName(branchSlug: string): string {
  return `orders:${branchSlug}`
}

export const ORDERS_UPDATED_EVENT = EVENT

export async function broadcastOrdersUpdated(branchSlug: string): Promise<void> {
  try {
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messages: [{ topic: orderChannelName(branchSlug), event: EVENT, payload: { at: Date.now() } }],
      }),
    })
  } catch {
    // Best-effort — a failed nudge just means the board falls back to its
    // existing poll interval. A realtime hiccup must never fail the order
    // write it's reporting on.
  }
}
