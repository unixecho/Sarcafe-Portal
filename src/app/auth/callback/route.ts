import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp, isStaff } from '@/lib/staff/access'
import { revokeEmployeeSession } from '@/lib/staff/session'
import { clearLinkCookie, GOOGLE_LINK_COOKIE, ONBOARDING_HEADERS, tokenHash } from '@/lib/staff/invitations'
import { POS_RETURN_COOKIE, safePosReturn } from '@/lib/staff/navigation'

function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('://') || raw.includes('\\') || /[\x00-\x1f]/.test(raw)) return null
  return raw
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))
  const linking = searchParams.has('link')
  const redirect = (path: string) => NextResponse.redirect(`${origin}${path}`, { headers: ONBOARDING_HEADERS })
  const supabase = await createServerSupabaseClient()
  const completedRedirect = async (path: string) => {
    const response = redirect(path)
    response.cookies.set(POS_RETURN_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
    await revokeEmployeeSession(response)
    return response
  }
  const failLink = async (reason = 'link_failed') => {
    await supabase.auth.signOut({ scope: 'local' })
    const response = redirect(`/staff/profile?setup=google&error=${reason}`)
    clearLinkCookie(response)
    return response
  }
  if (!code) return linking ? failLink() : redirect('/login?error=auth')
  const { data: exchanged, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return linking ? failLink() : redirect('/login?error=auth')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !exchanged.session) return linking ? failLink() : redirect('/login?error=auth')

  if (linking) {
    const proof = (await cookies()).get(GOOGLE_LINK_COOKIE)?.value
    // The URL contains only a hash. The bearer proof stays in an HttpOnly cookie;
    // Supabase's PKCE verifier separately binds the OAuth response to this browser.
    if (!proof || searchParams.get('link') !== tokenHash(proof) || !user.identities?.some((identity) => identity.provider === 'google')) return failLink()
    const { data, error: linkError } = await createServiceRoleClient().rpc('staff_finish_google_link', { p_token_hash: tokenHash(proof), p_auth_user: user.id })
    const result = data as { ok?: boolean; reason?: string } | null
    if (linkError || !result?.ok) return failLink(result?.reason === 'account_conflict' || result?.reason === 'already_linked' ? 'account_conflict' : 'link_failed')
    const response = await completedRedirect('/staff/profile?linked=1')
    clearLinkCookie(response)
    return response
  }

  // Legacy owner-entered email invitations remain compatible. Explicit link
  // intents above never fall back to claiming a different employee by email.
  await supabase.rpc('claim_staff_invite')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('auth/callback: service role is not configured')
    return redirect('/no-access?reason=server_misconfigured')
  }
  const { data: staffRow, error: staffError } = await createServiceRoleClient().from('staff')
    .select('role, badge, branch_id').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (staffError) {
    console.error('auth/callback: staff lookup failed:', staffError.code)
    return redirect('/no-access?reason=lookup_failed')
  }
  if (!isStaff(staffRow)) return completedRedirect('/no-access?reason=no_staff_row')
  if (next) {
    const station = next === '/pos' ? safePosReturn((await cookies()).get(POS_RETURN_COOKIE)?.value) : null
    return completedRedirect(station ?? next)
  }
  if (isOp(staffRow)) return completedRedirect('/owner/dashboard')
  return completedRedirect('/staff')
}
