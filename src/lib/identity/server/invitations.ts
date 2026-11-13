import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { INVITATION_PURPOSE, INVITATION_TOKEN_PREFIX } from '@/lib/identity/invitations'

// The secret half of an invitation. The token exists in three places only: the response that hands it to the issuer once, the
// link they copy, and (after the recipient opens it) an HttpOnly cookie. The database gets digests.

/** A fresh token: the purpose prefix and 256 random bits. */
export const newInvitationToken = (): string => INVITATION_TOKEN_PREFIX + randomBytes(32).toString('base64url')

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

/** What the database stores and looks up instead of the token. The purpose is part of the digest, so a token made for one purpose can never match a row of another. */
export const invitationTokenDigest = (token: string): string => sha256(`sarcafe:identity:invitation:${INVITATION_PURPOSE}:v1:${token}`)

/** The intended recipient, as the database compares it: the digest of the normalized address, never the address. */
export const recipientDigest = (normalizedEmail: string): string => sha256(`sarcafe:identity:recipient:v1:${normalizedEmail}`)
