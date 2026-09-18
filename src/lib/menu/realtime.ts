// Server-side "nudge" so the tablet and the public menu refetch instantly
// instead of waiting for their polling fallback — the websocket half of
// live availability. Uses Supabase Realtime's HTTP broadcast endpoint
// (https://supabase.com/docs/guides/realtime/broadcast) rather than
// supabase-js's channel().subscribe(), specifically because that needs a
// live websocket handshake first — wasteful (and slow) to open one just to
// send a single message from a short-lived Route Handler.
//
// The payload deliberately carries no menu content, just a timestamp: every
// subscriber already has its own authorized read path (the public menu's
// own REST fetch, the tablet's own /api/owner/menu-variants) and this is
// only ever a "go re-fetch" ping, never a trusted source of truth — the
// server stays authoritative, clients only receive.

const EVENT = 'menu-updated'

export function menuChannelName(branchSlug: string): string {
  return `menu:${branchSlug}`
}

export const MENU_UPDATED_EVENT = EVENT

export async function broadcastMenuUpdated(branchSlug: string): Promise<void> {
  try {
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messages: [{ topic: menuChannelName(branchSlug), event: EVENT, payload: { at: Date.now() } }],
      }),
    })
  } catch {
    // Best-effort — a failed nudge just means viewers fall back to their
    // existing poll interval instead of updating instantly. A realtime
    // hiccup must never fail the write it's reporting on.
  }
}
