import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'

/** True when the request carries `Authorization: Bearer <expected>`. Compared in constant time (both sides hashed
 *  to the same length first), and false when the secret is not configured, so a missing env var never opens a
 *  scheduled route. Vercel Cron sends this header itself when CRON_SECRET is set on the project. */
export function bearerMatches(authorization: string | null, expected: string | undefined): boolean {
  if (!expected || !authorization || !authorization.startsWith('Bearer ')) return false
  const given = createHash('sha256').update(authorization.slice('Bearer '.length)).digest()
  const wanted = createHash('sha256').update(expected).digest()
  return timingSafeEqual(given, wanted)
}
