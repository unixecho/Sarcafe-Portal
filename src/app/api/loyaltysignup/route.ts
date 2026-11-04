import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { readLimitedText } from '@/lib/kiosk/waitlist'
import { loyaltySecret } from '@/lib/loyalty/signup-env'
import { MAX_BODY_BYTES, WEB_LEGAL_VERSIONS, webSignupSchema } from '@/lib/loyalty/signup-shared'
import { checkFormToken, webCallerKey } from '@/lib/loyalty/signup-server'

// The public sign-up to the (future) loyalty club, from /loyaltysignup. Anyone on the internet may call it, so every layer is strict:
// same-origin only (the Origin header must be present and name this host; middleware also blocks cross-site writes, but a request
// with no Origin passes it, so this route checks for itself), JSON only, a real 2 KB body limit, a strict schema, a honeypot, a form
// token the page issued (a bot that posts blind has none; a person needs at least 3 seconds), and a per-caller and overall rate limit
// inside the database. The notice versions come from the language, never from the client. It answers with generic words, never logs
// the body or any contact detail, sends no CORS headers, and never says whether a number was already registered (otherwise this page
// would be a way to ask whether a phone number is on the list).

const HEADERS = { 'Cache-Control': 'no-store' }
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: HEADERS })

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return false
  try { if (new URL(origin).host !== host) return false } catch { return false }
  const site = request.headers.get('sec-fetch-site')
  return !site || site === 'same-origin'
}

export async function POST(request: NextRequest) {
  const secret = loyaltySecret()
  if (!secret) return reply(503, { ok: false, error: 'unavailable' })
  if (!sameOrigin(request)) return reply(403, { ok: false, error: 'forbidden' })
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return reply(415, { ok: false, error: 'bad_request' })
  }

  const text = await readLimitedText(request, MAX_BODY_BYTES)
  if (text === null) return reply(413, { ok: false, error: 'too_large' })

  let json: unknown
  try { json = JSON.parse(text) } catch { return reply(400, { ok: false, error: 'bad_request' }) }
  const parsed = webSignupSchema.safeParse(json)
  if (!parsed.success) {
    // field names only, never the received values
    const fields = Array.from(new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(body)'))).slice(0, 8)
    return reply(400, { ok: false, error: 'bad_request', fields })
  }
  const input = parsed.data

  // A bot filled the hidden field: look successful, store nothing.
  if (input.website.trim() !== '') return reply(200, { ok: true })

  const token = checkFormToken(input.token, secret)
  if (token === 'bad') return reply(400, { ok: false, error: 'bad_request' })
  if (token === 'expired') return reply(400, { ok: false, error: 'expired' })
  if (token === 'too_fast') return reply(429, { ok: false, error: 'too_fast' })

  const versions = WEB_LEGAL_VERSIONS[input.lang]
  try {
    const service = createServiceRoleClient()
    const { data, error } = await service.rpc('customer_waitlist_register', {
      p_first_name: input.firstName,
      p_phone: input.phone,
      p_email: input.email === '' ? null : input.email,
      p_marketing: input.marketing,
      p_privacy_version: versions.privacy,
      p_consent_version: versions.consent,
      p_terms_version: versions.terms,
      p_request_id: input.requestId,
      p_key_hash: webCallerKey(request.headers.get('x-forwarded-for'), secret),
      p_source: 'web',
    })
    if (error || !data) return reply(502, { ok: false, error: 'unavailable' })

    const result = data as { ok: boolean; error?: string }
    if (result.ok) return reply(200, { ok: true })
    // A number that is already on the list looks exactly like a new sign-up; the database changed nothing.
    if (result.error === 'already_registered') return reply(200, { ok: true })
    if (result.error === 'rate_limited') return reply(429, { ok: false, error: 'rate_limited' })
    if (result.error === 'unavailable') return reply(503, { ok: false, error: 'unavailable' })
    const field = result.error === 'bad_phone' ? 'phone' : result.error === 'bad_name' ? 'firstName' : result.error === 'bad_email' ? 'email' : null
    return reply(400, { ok: false, error: 'bad_request', ...(field ? { fields: [field] } : {}) })
  } catch {
    // no details: an error object could carry the contact fields
    return reply(502, { ok: false, error: 'unavailable' })
  }
}
