// Did THIS session sign in with Google? (FABLE-002 review R1, docs/SARCAFE_IDENTITY.md "Current-session proof".) Pure: no database,
// no network, no secrets. The server passes in the claims of the current access token (validated by the installed SDK's
// auth.getClaims(): signature against the project's keys, or the auth server itself for a symmetric key) and the user the auth
// server returned for that same session (auth.getUser()).
//
// Why both: an account can HAVE a verified Google identity while the current session was opened some other way (a password, a
// magic link, a recovery link). Linking Google to an account proves nothing about how this session began. So:
//   1. the claims must belong to the validated user (`sub` equals the user id) and name their session (`session_id`);
//   2. the session's authentication methods (`amr`) must say OAuth, and nothing else that signs a person in;
//   3. the account must hold a Google identity whose own address Google verified and that equals the account's confirmed address
//      (verifiedGoogleEmail).
//
// Limits, recorded on purpose: Supabase's AMR says `oauth`, not which provider. Step 2 + 3 mean "an OAuth sign-in on an account
// whose Google identity is verified"; they equal "a Google sign-in" only while Google is the ONLY OAuth provider enabled in the
// project's Auth settings. That setting, and one real Google round trip, are release prerequisites. Adding any other OAuth
// provider needs its own provenance review first. Never read `user_metadata`, `app_metadata.provider(s)` or the identity list as
// proof of how THIS session began: they describe the account, not the session.
import { verifiedGoogleEmail, type VerifiableUser } from '@/lib/identity/invitations'

/** Methods that are not a way of signing in: a second factor after it, or the token being refreshed. They neither prove nor spoil. */
const NEUTRAL = new Set(['token_refresh', 'totp', 'mfa/totp', 'mfa/phone', 'mfa/webauthn', 'mfa/recovery_code'])

export type SessionMethod = 'oauth' | 'other' | 'malformed'

/**
 * What the `amr` claim says about how this session signed in.
 * - `oauth`: at least one `oauth` entry, and every other entry is neutral (a second factor or a refresh);
 * - `other`: a well-formed list in which something else signed the person in (password, otp, magiclink, recovery, invite,
 *   email/signup, email_change, anonymous, sso/saml, web3, Supabase-as-OAuth-server, an unknown method), or no `oauth` at all;
 * - `malformed`: missing, not a list, empty, or an entry that is not `{ method: string, timestamp: finite number }` (the
 *   documented shape; the RFC 8176 plain-string form a custom hook could emit is refused rather than guessed at).
 */
export function sessionMethod(amr: unknown): SessionMethod {
  if (!Array.isArray(amr) || amr.length === 0 || amr.length > 16) return 'malformed'
  let oauth = false
  let other = false
  for (const entry of amr) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'malformed'
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown }
    if (typeof method !== 'string' || typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return 'malformed'
    if (method === 'oauth') oauth = true
    else if (!NEUTRAL.has(method)) other = true
  }
  return oauth && !other ? 'oauth' : 'other'
}

export type SessionClaims = Record<string, unknown>

/** Why a signed-in session is not a Google session. For tests and the audit of this rule; never shown to the person. */
export type SessionProofFailure = 'no_claims' | 'subject_mismatch' | 'no_session_id' | 'anonymous' | 'malformed_amr' | 'not_oauth' | 'no_verified_google_identity'

export type SessionProof =
  | { google: true; sessionId: string; verifiedEmail: string }
  | { google: false; sessionId: string | null; reason: SessionProofFailure }

/** The session id the claims name, only when they are this user's claims. Used to ask whether it is a quick (six-digit) session. */
export function boundSessionId(claims: SessionClaims | null | undefined, user: { id?: unknown } | null | undefined): string | null {
  if (!claims || !user || typeof user.id !== 'string' || claims.sub !== user.id) return null
  const id = claims.session_id
  return typeof id === 'string' && id.length > 0 && id.length <= 128 ? id : null
}

/** The whole rule. `google: true` is the only answer that may open identity administration or accept an invitation. */
export function proveGoogleSession(claims: SessionClaims | null | undefined, user: (VerifiableUser & { id?: unknown }) | null | undefined): SessionProof {
  if (!claims || typeof claims !== 'object') return { google: false, sessionId: null, reason: 'no_claims' }
  if (!user || typeof user.id !== 'string' || claims.sub !== user.id) return { google: false, sessionId: null, reason: 'subject_mismatch' }
  const sessionId = boundSessionId(claims, user)
  if (!sessionId) return { google: false, sessionId: null, reason: 'no_session_id' }
  if (claims.is_anonymous === true) return { google: false, sessionId, reason: 'anonymous' }
  const method = sessionMethod(claims.amr)
  if (method === 'malformed') return { google: false, sessionId, reason: 'malformed_amr' }
  if (method !== 'oauth') return { google: false, sessionId, reason: 'not_oauth' }
  const verifiedEmail = verifiedGoogleEmail(user)
  if (!verifiedEmail) return { google: false, sessionId, reason: 'no_verified_google_identity' }
  return { google: true, sessionId, verifiedEmail }
}
