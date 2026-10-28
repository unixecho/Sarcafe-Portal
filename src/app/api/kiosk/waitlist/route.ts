import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { callerKey, keysMatch, readLimitedText, signupSchema } from '@/lib/kiosk/waitlist'

// The kiosk's sign-up to the (future) loyalty club. Anonymous by nature (a customer at the counter), so every
// layer is strict: the kiosk's shared key, a real body-size limit, a strict schema, a honeypot, a rate limit inside
// the database transaction, and the current notice versions only. It answers with generic words and never logs the
// body or any contact detail. Nothing is queued or stored on the tablet; if this fails the person is told so.
//
// Inert until the owner sets KIOSK_SIGNUP_KEY in the host's environment: without it every call answers 503.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Kiosk-Key',
  'Cache-Control': 'no-store',
}

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: CORS })

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(request: NextRequest) {
  const secret = process.env.KIOSK_SIGNUP_KEY
  if (!secret) return reply(503, { ok: false, error: 'not_configured' })
  if (!keysMatch(request.headers.get('x-kiosk-key'), secret)) return reply(401, { ok: false, error: 'unauthorized' })
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return reply(415, { ok: false, error: 'bad_request' })
  }

  const text = await readLimitedText(request)
  if (text === null) return reply(413, { ok: false, error: 'too_large' })

  let json: unknown
  try { json = JSON.parse(text) } catch { return reply(400, { ok: false, error: 'bad_request' }) }
  const parsed = signupSchema.safeParse(json)
  if (!parsed.success) {
    // field names only, never the received values
    const fields = Array.from(new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(body)'))).slice(0, 8)
    return reply(400, { ok: false, error: 'bad_request', fields })
  }
  const input = parsed.data

  // A bot filled the hidden field: look successful, store nothing.
  if (input.website.trim() !== '') return reply(200, { ok: true })

  try {
    const service = createServiceRoleClient()
    const { data, error } = await service.rpc('customer_waitlist_register', {
      p_first_name: input.firstName,
      p_phone: input.phone,
      p_email: input.email === '' ? null : input.email,
      p_marketing: input.marketing,
      p_privacy_version: input.privacyVersion,
      p_consent_version: input.consentVersion,
      p_terms_version: input.termsVersion,
      p_request_id: input.requestId,
      p_key_hash: callerKey(request.headers.get('x-forwarded-for'), secret),
    })
    if (error || !data) return reply(502, { ok: false, error: 'unavailable' })

    const result = data as { ok: boolean; error?: string }
    if (result.ok) return reply(200, { ok: true })
    if (result.error === 'rate_limited') return reply(429, { ok: false, error: 'rate_limited' })
    // This number is already on the list. Nothing was changed, and the kiosk says so to the person at the screen.
    if (result.error === 'already_registered') return reply(409, { ok: false, error: 'already_registered' })
    if (result.error === 'unavailable') return reply(503, { ok: false, error: 'unavailable' })
    const field = result.error === 'bad_phone' ? 'phone' : result.error === 'bad_name' ? 'firstName' : result.error === 'bad_email' ? 'email' : null
    return reply(400, { ok: false, error: 'bad_request', ...(field ? { fields: [field] } : {}) })
  } catch {
    // no details: an error object could carry the contact fields
    return reply(502, { ok: false, error: 'unavailable' })
  }
}
