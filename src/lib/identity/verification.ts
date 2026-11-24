// Pure rules of QR credentials and staff verification (FABLE-004, docs/SARCAFE_IDENTITY.md). No database, no secrets, no Node-only
// code: the employee's card, the operator's scanner and the server read the same token shape and lifetimes.

/** `sc1_` (scan credential, version 1) followed by 32 random bytes in base64url. The QR carries THIS and nothing else. */
export const CREDENTIAL_TOKEN_PREFIX = 'sc1_'
const TOKEN = /^sc1_[A-Za-z0-9_-]{43}$/
export const isCredentialToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value)

/**
 * What a scanned QR may be: exactly one credential token, nothing around it but whitespace. The decoded text of a QR is chosen by
 * whoever printed it, so it is NEVER navigated to, never put in a URL, never shown: a URL, a token inside other text, an order
 * receipt's code, anything longer than a token, are all "not a card" (null).
 */
export function parseScannedCredential(decoded: unknown): string | null {
  if (typeof decoded !== 'string' || decoded.length > 80) return null
  const text = decoded.trim()
  return isCredentialToken(text) ? text : null
}

/** How long one card QR lives (the card renews itself a minute before), and the limits the database enforces. */
export const CARD_LIFETIME_SECONDS = 15 * 60
export const CARD_RENEW_BEFORE_SECONDS = 60
/** An open verification waits this long for the operator's decision; a match is valid this long for one redemption. */
export const VERIFICATION_SECONDS = 120
export const MATCH_SECONDS = 300

export type VerificationDecision = 'match' | 'mismatch' | 'cancel'
export const VERIFICATION_DECISIONS: readonly VerificationDecision[] = ['match', 'mismatch', 'cancel']

/** The name to show the operator: first name and last name, and the nickname in brackets when there is one. */
export const displayName = (person: { firstName: string; lastName: string | null; nickname: string | null }) =>
  `${person.firstName}${person.lastName ? ` ${person.lastName}` : ''}${person.nickname ? ` (${person.nickname})` : ''}`
