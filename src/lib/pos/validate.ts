// Input normalisers — pure, used on both sides of the wire. The DATABASE is the
// real validator (014/015 re-check everything); these exist so the UI can say
// "that phone number looks wrong" before a round trip, and so the server can
// reject early with a precise code.

import { HANDLE_PATTERN, LIMITS, PHONE_PATTERN } from './vocab'

/** Customer name: trimmed, inner whitespace collapsed, 1..40, no control characters. null when unusable. */
export function normalizeCustomerName(input: string | null | undefined): string | null {
  const s = (input ?? '').trim().replace(/\s+/g, ' ')
  if (s.length < 1 || Array.from(s).length > LIMITS.customerNameMax) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(s)) return null
  return s
}

/** Phone: digits and a leading +, 7..15 digits. '' / null → null (it is optional). 'invalid' when present but bad. */
export function normalizePhone(input: string | null | undefined): string | null | 'invalid' {
  const raw = (input ?? '').trim()
  if (raw === '') return null
  const s = raw.replace(/[\s()-]/g, '')
  return PHONE_PATTERN.test(s) ? s : 'invalid'
}

/** "0541234567" → "054-123 4567" for display (Israeli mobile); anything else unchanged. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const m = /^(05\d)(\d{3})(\d{4})$/.exec(phone)
  return m ? `${m[1]}-${m[2]} ${m[3]}` : phone
}

export function isValidHandle(input: string): boolean {
  return HANDLE_PATTERN.test(input.trim())
}

export type HandleProblem = 'too_short' | 'too_long' | 'bad_chars' | null
/** A specific reason for the live hint under the nickname field. */
export function handleProblem(input: string): HandleProblem {
  const s = input.trim()
  const len = Array.from(s).length
  if (len < LIMITS.handleMin) return 'too_short'
  if (len > LIMITS.handleMax) return 'too_long'
  return HANDLE_PATTERN.test(s) ? null : 'bad_chars'
}

/** A free-text note, trimmed and capped; null when empty. */
export function normalizeNote(input: string | null | undefined, max: number): string | null {
  const s = (input ?? '').trim().replace(/\s+/g, ' ')
  if (!s) return null
  return Array.from(s).length > max ? Array.from(s).slice(0, max).join('') : s
}

/** A hand-typed price ("12", "12,5", "12.50") → agorot; null when not a plain amount. Zero is valid. */
export function parsePriceInput(input: string): number | null {
  const s = input.trim()
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(s)) return null
  return Math.round(Number(s.replace(',', '.')) * 100)
}
