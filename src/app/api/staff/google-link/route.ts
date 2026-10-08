import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { ApiError } from '@/lib/http/errors'
import { parseBody } from '@/lib/pos/server/guard'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { credentialRoute, GOOGLE_LINK_COOKIE, limitInvitation, newToken, ONBOARDING_HEADERS, setLinkCookie, tokenHash } from '@/lib/staff/invitations'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare'), passcode: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ action: z.literal('start') }).strict(),
])

export const POST = credentialRoute(async (request: NextRequest) => {
  const body = await parseBody(request, schema)
  const service = createServiceRoleClient()
  if (body.action === 'prepare') {
    const identity = await resolveStaffIdentity()
    if (!identity) throw new ApiError(401, 'unauthorized', 'יש להתחבר לפני קישור Google.')
    await limitInvitation(request, 'google-pin', identity.id)
    const proof = newToken()
    const { data, error } = await service.rpc('staff_prepare_google_link', { p_staff: identity.id, p_pin: body.passcode, p_link_hash: tokenHash(proof) })
    if (error) throw new ApiError(503, 'unavailable', 'קישור החשבון אינו זמין כרגע.')
    if ((data as { ok?: boolean })?.ok !== true) throw new ApiError(401, 'unauthorized', 'הקוד אינו נכון. נסו שוב.')
    const response = NextResponse.json({ ok: true }, { headers: ONBOARDING_HEADERS })
    setLinkCookie(response, proof)
    return response
  }
  const proof = (await cookies()).get(GOOGLE_LINK_COOKIE)?.value
  if (!proof) throw new ApiError(409, 'proof_expired', 'אישור הקישור פג. הזינו שוב את הקוד האישי שלכם.')
  await limitInvitation(request, 'google-start', proof)
  const { data, error } = await service.rpc('staff_google_link_ready', { p_token_hash: tokenHash(proof) })
  if (error || data !== true) throw new ApiError(409, 'proof_expired', 'אישור הקישור פג. הזינו שוב את הקוד האישי שלכם.')
  const supabase = await createServerSupabaseClient()
  const origin = new URL(request.url).origin
  const { data: oauth, error: oauthError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: {
    redirectTo: `${origin}/auth/callback?link=${tokenHash(proof)}`, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' },
  } })
  if (oauthError || !oauth.url) throw new ApiError(503, 'unavailable', 'לא הצלחנו לפתוח Google. נסו שוב.')
  return NextResponse.json({ url: oauth.url }, { headers: ONBOARDING_HEADERS })
})
