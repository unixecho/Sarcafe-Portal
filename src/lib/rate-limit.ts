import { createServiceRoleClient } from '@/lib/supabase/server'
import type { NextRequest } from 'next/server'

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

/** Vercel sets x-forwarded-for; trusted because it can't be spoofed
 * client-side (Vercel's edge overwrites it, doesn't merely append). */
export function clientIp(request: Request | NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || 'unknown'
}
