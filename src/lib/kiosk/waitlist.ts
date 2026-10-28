import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

// The kiosk sign-up contract (docs/SARCAFE_KIOSK_GATE3_ARCHITECTURE.md section 5), pure and server-only.
// The wording the visitor agrees to lives in prototypes/sarcafe-kiosk-app/overrides/kiosk-legal.js; the three
// versions below name that exact wording, are stored with every sign-up, and the server accepts ONLY the current
// ones, so a stale or hand-made form cannot record consent to text that is not the text on screen.

export const KIOSK_PRIVACY_VERSION = 'kiosk-privacy-he-v5-2026-10-28'
export const KIOSK_CONSENT_VERSION = 'kiosk-consent-he-v5-2026-10-28'
export const KIOSK_TERMS_VERSION = 'kiosk-terms-he-v4-2026-10-28'

/** The longest body the endpoint reads. The form is a name, a phone and an e-mail; anything bigger is not from the kiosk. */
export const MAX_BODY_BYTES = 4096

export const signupSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60),
    phone: z.string().trim().min(9).max(20),
    email: z.string().trim().max(254).optional().default(''),
    /** The required acknowledgement of the privacy notice and the terms. Must be literally true. */
    acknowledged: z.literal(true),
    /** The separate, optional marketing consent. */
    marketing: z.boolean(),
    requestId: z.string().uuid(),
    privacyVersion: z.literal(KIOSK_PRIVACY_VERSION),
    consentVersion: z.literal(KIOSK_CONSENT_VERSION),
    termsVersion: z.literal(KIOSK_TERMS_VERSION),
    /** Honeypot: a person never sees this field; a bot fills it. */
    website: z.string().max(200).optional().default(''),
  })
  .strict()

export type SignupInput = z.infer<typeof signupSchema>

/**
 * Reads a request body with a real byte limit (Content-Length can lie or be absent). Returns null when the body is
 * larger than `max`, so the caller can answer 413 without ever holding the oversized body.
 */
export async function readLimitedText(request: Request, max: number = MAX_BODY_BYTES): Promise<string | null> {
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
}

/** Constant-time comparison of the kiosk's shared key (hashed first so the lengths always match). */
export function keysMatch(given: string | null, expected: string): boolean {
  if (!given || !expected) return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * The rate-limit key: an HMAC of the caller's address with the kiosk secret and the date, so no raw address is ever
 * stored and the key changes every day. (A kiosk behind one carrier or shop router is one caller; the limits are set
 * for that.)
 */
export function callerKey(forwardedFor: string | null, secret: string, now: Date = new Date()): string {
  const ip = (forwardedFor ?? '').split(',')[0]?.trim() || 'unknown'
  return createHmac('sha256', secret).update(`${now.toISOString().slice(0, 10)}|${ip}`).digest('hex')
}
