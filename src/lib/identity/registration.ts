// Pure rules of employee registration (FABLE-003, docs/SARCAFE_IDENTITY.md). No database, no secrets, no Node-only code: the
// registration page (a browser component) reads the same token shape, link, limits and states the server uses.

/** `er1_` (employee registration, version 1) followed by 32 random bytes in base64url: 256 bits nobody can guess. */
export const REGISTRATION_TOKEN_PREFIX = 'er1_'
const TOKEN = /^er1_[A-Za-z0-9_-]{43}$/
export const isRegistrationToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value)

/** The secret of a registration SESSION (made by the server when a link is opened; lives only in an HttpOnly cookie). */
export const SESSION_TOKEN_PREFIX = 'rs1_'
const SESSION = /^rs1_[A-Za-z0-9_-]{43}$/
export const isSessionToken = (value: unknown): value is string => typeof value === 'string' && SESSION.test(value)

/** How long a registration link may stay open. The database refuses anything beyond 14 days whatever a caller sends. */
export const REGISTRATION_EXPIRY_HOURS = [72, 168, 336] as const
export const DEFAULT_REGISTRATION_EXPIRY_HOURS = 168
export const isRegistrationExpiry = (value: unknown): value is (typeof REGISTRATION_EXPIRY_HOURS)[number] =>
  typeof value === 'number' && (REGISTRATION_EXPIRY_HOURS as readonly number[]).includes(value)

/**
 * The two HttpOnly cookies of the registration page, both sent ONLY to /api/benefits/register:
 * - the link's token, between opening the link and signing in (30 minutes);
 * - the registration session's secret, once the signed-in person has opened the link (one hour; the database allows at most two).
 */
export const REGISTRATION_COOKIE_PATH = '/api/benefits/register'
export const REGISTRATION_INVITE_COOKIE = 'sarcafe_benefits_register_link'
export const REGISTRATION_INVITE_MAX_AGE = 30 * 60
export const REGISTRATION_SESSION_COOKIE = 'sarcafe_benefits_register'
export const REGISTRATION_SESSION_MAX_AGE = 60 * 60

/** The link a department head copies. The token is in the FRAGMENT (never sent to a server, never in a log or a Referer). */
export const registrationLink = (origin: string, token: string) => `${origin}/benefits/register#${token}`

/** What a person may send as a photo, before the server checks the image itself (it decodes and re-encodes every one). */
export const PHOTO_UPLOAD_MAX_BYTES = 8 * 1024 * 1024
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'
/** The stored image: a JPEG at most this many pixels on its long side, at least this many on its short side. */
export const PHOTO_MAX_SIDE = 1024
export const PHOTO_MIN_SIDE = 200

export type MembershipState = 'pending' | 'approved' | 'rejected' | 'inactive'
export const MEMBERSHIP_STATES: readonly MembershipState[] = ['pending', 'approved', 'rejected', 'inactive']
export const isMembershipState = (value: unknown): value is MembershipState => typeof value === 'string' && (MEMBERSHIP_STATES as readonly string[]).includes(value)

export type ReviewDecision = 'approve' | 'reject' | 'deactivate' | 'reactivate'
/** Which decision each state allows (the database says the same, and answers 'conflict' otherwise). */
export const DECISIONS_FOR: Record<MembershipState, readonly ReviewDecision[]> = {
  pending: ['approve', 'reject'],
  approved: ['deactivate'],
  inactive: ['reactivate'],
  rejected: [],
}
/** Decisions that must say why (the reason is kept with the decision and in the audit). */
export const NEEDS_REASON: readonly ReviewDecision[] = ['reject', 'deactivate']

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/**
 * A name as the database stores it: trimmed, inner runs of spaces made one, between 1 and `max` characters, no control characters.
 * Nothing cleverer: two people whose names look alike stay two people (no folding, no transliteration). Null when it is not one.
 */
export function normalizeName(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const name = value.replace(/\s+/g, ' ').trim()
  if (!name || Array.from(name).length > max || CONTROL.test(name)) return null
  return name
}
export const NAME_MAX = 60
export const NICKNAME_MAX = 40
