import { createServiceRoleClient } from '@/lib/supabase/server'
import type { NextRequest } from 'next/server'
import { createHmac } from 'node:crypto'

/**
 * Calls the check_rate_limit() RPC via the service-role client. Fails OPEN
 * (returns true/allowed) on any error or thrown exception — mirrors
 * AyekaBar's explicit reasoning: "a rate limiter's job is to blunt abuse,
 * not become a new single point of failure." Never make an unrelated
 * outage also take down login/menu-editing.
 */
export async function checkRateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const service = createServiceRoleClient()
    const { data, error } = await service.rpc('check_rate_limit', {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    })
    if (error) return true
    return data !== false
  } catch {
    return true
  }
}

/** Credential entry points fail closed: if the limiter cannot verify that an
 * attempt is allowed, accepting a six-digit secret would remove the brute-force
 * boundary entirely. Other, non-credential uses keep the fail-open helper above. */
export async function checkCredentialRateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const service = createServiceRoleClient()
    const { data, error } = await service.rpc('check_rate_limit', {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    })
    if (error) return false
    return data === true
  } catch {
    return false
  }
}

/** Vercel sets x-forwarded-for; trusted because it can't be spoofed
 * client-side (Vercel's edge overwrites it, doesn't merely append). */
export function clientIp(request: Request | NextRequest): string {
  const forwarded = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || 'unknown'
}

/** Stable, non-reversible key for credential throttles. Raw IP addresses and
 * employee numbers never need to be written into the rate-limit table. */
export function credentialFingerprint(value: string): string {
  const secret = process.env.RATE_LIMIT_KEY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) return 'unavailable'
  return createHmac('sha256', secret).update(value).digest('hex').slice(0, 32)
}
