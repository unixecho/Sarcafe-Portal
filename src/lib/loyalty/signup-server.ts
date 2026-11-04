import { createHmac, timingSafeEqual } from 'node:crypto'

// Server side of /loyaltysignup: the form token and the rate-limit key. Pure given a secret (no environment read here), so
// scripts/check-loyalty-signup.mjs runs this very file.

/** A form younger than this was not filled in by a person (a bot posts at once). */
export const TOKEN_MIN_AGE_MS = 3_000
/** A form older than this is stale: the page is loaded again. */
export const TOKEN_MAX_AGE_MS = 3 * 60 * 60 * 1000

const sign = (secret: string, issuedAt: number) => createHmac('sha256', secret).update(`loyalty-form|${issuedAt}`).digest('hex').slice(0, 32)

/** "<issued at ms>.<signature>". Issued when the page is rendered. */
export function makeFormToken(secret: string, now: number = Date.now()): string {
  return `${now}.${sign(secret, now)}`
}

export type TokenCheck = 'ok' | 'bad' | 'too_fast' | 'expired'

export function checkFormToken(token: string, secret: string, now: number = Date.now()): TokenCheck {
  const [stamp, signature, extra] = token.split('.')
  if (extra !== undefined || !stamp || !signature || !/^\d{10,16}$/.test(stamp)) return 'bad'
  const issuedAt = Number(stamp)
  const want = Buffer.from(sign(secret, issuedAt))
  const got = Buffer.from(signature)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return 'bad'
  const age = now - issuedAt
  if (age < 0 || age < TOKEN_MIN_AGE_MS) return 'too_fast'
  if (age > TOKEN_MAX_AGE_MS) return 'expired'
  return 'ok'
}

/**
 * An HMAC of the caller's address and the date (no raw address is ever stored, and the key changes every day). Its own prefix keeps
 * it apart from the kiosk's and the poll's keys.
 */
export function webCallerKey(forwardedFor: string | null, secret: string, now: Date = new Date()): string {
  const ip = (forwardedFor ?? '').split(',')[0]?.trim() || 'unknown'
  return createHmac('sha256', secret).update(`loyalty-web|${now.toISOString().slice(0, 10)}|${ip}`).digest('hex')
}
