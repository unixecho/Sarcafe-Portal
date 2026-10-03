// Server-only resolution of a customer's opaque order token — the one
// piece of the POS a customer's own phone ever talks to directly (no
// staff session, no cookie). See migration 018's header for the full
// secret-handling posture: only a hash is ever stored, so this can
// verify a presented token but can never hand one back out.

import { createHash } from 'crypto'
import { createServiceRoleClient } from '@/lib/supabase/server'

/** Must byte-for-byte match hash_order_secret() in migration 018 — both
 *  are plain SHA-256 hex over the UTF-8 string, no salt (the token has
 *  160 bits of its own entropy; the recovery code's defense is
 *  rate-limiting, not the hash — see that migration's header). */
export function hashOrderSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Resolves a presented QR/link token to an order id, or null if it
 *  doesn't match anything live (wrong, rotated-away, or past its
 *  expires_at). Deliberately the same "no distinction" posture as
 *  verify_order_recovery_code() — never tell the caller WHY it failed. */
export async function resolveOrderIdByToken(token: string): Promise<string | null> {
  if (!token || token.length > 200) return null

  const service = createServiceRoleClient()
  const { data } = await service
    .from('order_access')
    .select('order_id, expires_at')
    .eq('token_hash', hashOrderSecret(token))
    .maybeSingle()

  if (!data) return null
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null
  return data.order_id as string
}
