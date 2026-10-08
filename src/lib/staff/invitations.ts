import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import type { NextResponse } from 'next/server'
import { ApiError, apiRoute } from '@/lib/http/errors'
import { checkCredentialRateLimit, clientIp, credentialFingerprint } from '@/lib/rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const GOOGLE_LINK_COOKIE = 'sarcafe_google_link'
export const LINK_SECONDS = 15 * 60
export const ONBOARDING_HEADERS = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' }
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')

/** Credential errors are just as uncacheable as successful responses. */
export function credentialRoute<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  const wrapped = apiRoute(handler)
  return async (...args: Args) => {
    const response = await wrapped(...args)
    Object.entries(ONBOARDING_HEADERS).forEach(([name, value]) => response.headers.set(name, value))
    return response
  }
}

export async function limitInvitation(request: Request, scope: string, secret: string) {
  const ip = credentialFingerprint(clientIp(request))
  const target = credentialFingerprint(secret)
  const [perIp, perToken] = await Promise.all([
    checkCredentialRateLimit(`onboard:${scope}:ip:${ip}`, 30, 900),
    checkCredentialRateLimit(`onboard:${scope}:target:${target}`, 12, 900),
  ])
  if (!perIp || !perToken) throw new ApiError(429, 'rate_limited', 'יותר מדי ניסיונות. חכו כמה דקות ונסו שוב.')
}

export function setLinkCookie(response: NextResponse, token: string) {
  response.cookies.set(GOOGLE_LINK_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: LINK_SECONDS })
}

export function clearLinkCookie(response: NextResponse) {
  response.cookies.set(GOOGLE_LINK_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
}

export async function createStaffInvitation(actorId: string, staffId: string, origin: string) {
  const token = newToken()
  const { data, error } = await createServiceRoleClient().rpc('staff_create_invitation', { p_actor: actorId, p_staff: staffId, p_token_hash: tokenHash(token) })
  if (error) throw new ApiError(500, 'internal_error', 'לא הצלחנו ליצור קישור הזמנה. נסו שוב.')
  const result = data as { ok?: boolean; reason?: string; expires_at?: string }
  if (!result?.ok || !result.expires_at) throw new ApiError(409, 'conflict', result?.reason === 'profile_incomplete' ? 'קודם מלאו שם פרטי, שם משפחה ומספר עובד HYP.' : 'אי אפשר ליצור קישור עבור העובד/ת הזה/ו.', { reason: result?.reason })
  return { url: `${origin}/staff/onboarding#invite=${token}`, expiresAt: result.expires_at }
}
