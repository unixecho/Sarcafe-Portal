import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { readLimitedText } from '@/lib/kiosk/waitlist'
import { feedbackCallerKey } from '@/lib/kiosk/content'
import { FEEDBACK_MAX_BODY_BYTES, feedbackSchema } from '@/lib/kiosk/content-schema'

// The public "what should the cart offer" poll (/feedback, opened from the kiosk's QR). Anonymous by design and it
// collects NO personal data: up to three option votes, an optional suggestion, an optional rating. Every layer is
// strict all the same: same origin only, JSON only, a real body-size limit, a strict schema, a honeypot, a rate limit
// inside the database transaction keyed by an HMAC of the caller (raw addresses are never stored), and an idempotent
// request id. Answers are short codes; the body and the suggestion are never logged.

const reply = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: NextRequest) {
  // Same origin only: the poll page is ours, and no other site may post into it.
  const origin = request.headers.get('origin')
  if (origin) {
    let originHost: string | null = null
    try { originHost = new URL(origin).host } catch { originHost = null }
    if (!originHost || originHost !== request.headers.get('host')) return reply(403, { ok: false, error: 'forbidden' })
  }
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return reply(415, { ok: false, error: 'bad_request' })
  }

  const text = await readLimitedText(request, FEEDBACK_MAX_BODY_BYTES)
  if (text === null) return reply(413, { ok: false, error: 'too_large' })

  let json: unknown
  try { json = JSON.parse(text) } catch { return reply(400, { ok: false, error: 'bad_request' }) }
  const parsed = feedbackSchema.safeParse(json)
  if (!parsed.success) {
    // field names only, never the received values
    const fields = Array.from(new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(body)'))).slice(0, 8)
    return reply(400, { ok: false, error: 'bad_request', fields })
  }
  const input = parsed.data

  // A bot filled the hidden field: look successful, store nothing.
  if (input.website.trim() !== '') return reply(200, { ok: true })

  const keyHash = feedbackCallerKey(request.headers.get('x-forwarded-for'))
  if (!keyHash) return reply(503, { ok: false, error: 'unavailable' })

  try {
    const { data, error } = await createServiceRoleClient().rpc('kiosk_feedback_submit', {
      p_option_ids: input.optionIds,
      p_suggestion: input.suggestion.trim() === '' ? null : input.suggestion,
      p_rating: input.rating,
      p_request_id: input.requestId,
      p_key_hash: keyHash,
    })
    if (error || !data) return reply(502, { ok: false, error: 'unavailable' })
    const result = data as { ok: boolean; error?: string }
    if (result.ok) return reply(200, { ok: true })
    if (result.error === 'rate_limited') return reply(429, { ok: false, error: 'rate_limited' })
    if (result.error === 'unavailable') return reply(503, { ok: false, error: 'unavailable' })
    // empty, bad_option (an option the owner just switched off), bad_suggestion, bad_rating, too_many_options
    return reply(400, { ok: false, error: result.error ?? 'bad_request' })
  } catch {
    // no details: an error object could carry the suggestion text
    return reply(502, { ok: false, error: 'unavailable' })
  }
}
