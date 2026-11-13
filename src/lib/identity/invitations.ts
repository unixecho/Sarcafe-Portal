// Pure rules of department-head invitations (FABLE-002, docs/SARCAFE_IDENTITY.md). No database, no secrets, no Node-only code:
// the invitation page (a browser component) reads the same token shape and link the server writes.

/** What an invitation is for. One purpose today; the token's prefix and the stored row both carry it. */
export const INVITATION_PURPOSE = 'department_head' as const

/** `dh1_` (purpose + version) followed by 32 random bytes in base64url: 256 bits nobody can guess. */
export const INVITATION_TOKEN_PREFIX = 'dh1_'
const TOKEN = /^dh1_[A-Za-z0-9_-]{43}$/
export const isInvitationToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value)

/** How long an invitation may stay open. The database refuses anything beyond 30 days whatever a caller sends. */
export const INVITATION_EXPIRY_HOURS = [24, 72, 168] as const
export const DEFAULT_INVITATION_EXPIRY_HOURS = 72
export const isInvitationExpiry = (value: unknown): value is (typeof INVITATION_EXPIRY_HOURS)[number] =>
  typeof value === 'number' && (INVITATION_EXPIRY_HOURS as readonly number[]).includes(value)

/** The HttpOnly cookie that holds the token between the link and the acceptance (never the URL, never script-readable). */
export const INVITATION_COOKIE = 'sarcafe_benefits_invite'
export const INVITATION_COOKIE_PATH = '/api/benefits/invite'
export const INVITATION_COOKIE_MAX_AGE = 30 * 60

/**
 * The link the issuer copies. The token is in the FRAGMENT: a browser never sends a fragment to a server, so it is in no access
 * log, no Referer header and no redirect. The page trades it for the cookie above and removes it from the address bar at once.
 */
export const invitationLink = (origin: string, token: string) => `${origin}/benefits/invite#${token}`

/** The only places a benefits sign-in may return to (the auth callback accepts exactly these, never a prefix). */
export const BENEFITS_RETURNS = ['/benefits/manage', '/benefits/invite'] as const
export const isBenefitsReturn = (path: unknown): path is (typeof BENEFITS_RETURNS)[number] =>
  typeof path === 'string' && (BENEFITS_RETURNS as readonly string[]).includes(path)

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

/**
 * An address as the invitation compares it: trimmed and lower-cased, nothing cleverer (no dot or plus folding: guessing that two
 * different addresses are one person is exactly the automatic matching this system refuses). Null when it is not an address.
 */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && EMAIL.test(email) ? email : null
}

/** What a list shows instead of the address: its first character and its domain (`d***@example.org`). */
export function recipientHint(email: string): string {
  const at = email.lastIndexOf('@')
  return `${Array.from(email)[0] ?? ''}***${email.slice(at)}`.slice(0, 80)
}

/** The parts of a Supabase Auth user this rule reads. Everything else on the user (above all `user_metadata`) is ignored. */
export type VerifiableUser = {
  email?: string | null
  email_confirmed_at?: string | null
  identities?: Array<{ provider?: string | null; identity_data?: Record<string, unknown> | null }> | null
}

/**
 * The address this signed-in user has PROVEN, or null. Proven means: the auth server lists a Google identity whose own address
 * Google marked verified, and that is the account's confirmed address. An address somebody typed, `user_metadata`, a name, or an
 * account that signed in some other way proves nothing and gives null: such a user cannot accept an invitation at all.
 */
export function verifiedGoogleEmail(user: VerifiableUser | null | undefined): string | null {
  if (!user || !user.email_confirmed_at) return null
  const account = normalizeEmail(user.email)
  if (!account) return null
  for (const identity of user.identities ?? []) {
    if (identity?.provider !== 'google') continue
    const data = identity.identity_data ?? {}
    if (data.email_verified === true && normalizeEmail(data.email) === account) return account
  }
  return null
}
