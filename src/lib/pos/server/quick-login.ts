// Provenance checks for historical PIN JWTs (migration 022).
//
// New PIN logins use opaque staff cookies. Historical sessions still need their
// permanent marker checked by every full-login guard. Because six
// digits are a much weaker secret than a Google account, the session is recorded in
// pos_quick_sessions (keyed by the JWT's own session_id) and treated as SECOND-CLASS
// by the guards: floor work only. The client cannot lift that — the id comes from the
// token GoTrue signed, and the table has no client grant.

import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Forbidden } from '@/lib/http/errors'
import { jwtSessionId } from '@/lib/pos/quick-jwt'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'

/** Deliberately says nothing about WHY — the route turns every failure into one generic answer. */
export class QuickLoginFailed extends Error {
  constructor() {
    super('quick login failed')
  }
}

/**
 * Mints a genuine session for an already-VERIFIED staff member (the caller has run
 * pos_verify_pin). Any failure signs the half-made session out and throws, so a
 * failed mint can never leave a half-authenticated cookie behind.
 */
export async function mintQuickSession(staff: { id: string; email: string }): Promise<void> {
  const service = createServiceRoleClient()
  const supabase = await createServerSupabaseClient()
  let minted = false
  try {
    // (1) A one-time token for the person's existing auth user. generateLink sends no email.
    const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: 'magiclink', email: staff.email })
    const tokenHash = link?.properties?.hashed_token
    if (linkErr || !tokenHash) throw new QuickLoginFailed()

    // The account the link belongs to must be the account this staff row is linked to.
    // (generateLink on an unknown email would otherwise quietly create a brand-new user.)
    const { data: row } = await service.from('staff').select('auth_user_id').eq('id', staff.id).eq('active', true).maybeSingle()
    const expectedUser = (row as { auth_user_id: string | null } | null)?.auth_user_id
    if (!expectedUser || link?.user?.id !== expectedUser) throw new QuickLoginFailed()

    // (2) Redeem it on the cookie-bound client: the session cookies are set exactly as
    // a Google sign-in sets them.
    const { data: verified, error: verifyErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
    minted = true
    if (verifyErr || !verified.session || verified.user?.id !== expectedUser) throw new QuickLoginFailed()

    // (3) + (4) Record it as quick, by the token's own session id.
    const sessionId = jwtSessionId(verified.session.access_token)
    if (!sessionId) throw new QuickLoginFailed()
    const { error: insertErr } = await service.from('pos_quick_sessions').insert({ session_id: sessionId, staff_id: staff.id })
    if (insertErr) throw new QuickLoginFailed()
  } catch {
    if (minted) {
      try {
        await supabase.auth.signOut()
      } catch {
        /* nothing more can be done; the cookie is cleared best-effort */
      }
    }
    throw new QuickLoginFailed()
  }
}

/** Is this session id one a passcode minted? A failed read THROWS: callers fail closed. */
export async function isQuickSessionId(sessionId: string | null): Promise<boolean> {
  if (!sessionId) return true
  const service = createServiceRoleClient()
  const { data, error } = await service.from('pos_quick_sessions').select('session_id').eq('session_id', sessionId).maybeSingle()
  if (error) throw new Error('quick session lookup failed')
  return data !== null
}

/**
 * The session id of an ALREADY-VALIDATED user: call after auth.getUser() succeeded on
 * the same client. getSession() only reads the cookie here, which is why getUser()
 * must come first.
 */
export async function validatedSessionId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return jwtSessionId(session?.access_token)
}

/** Is the current request a quick-login session? Cached per request. */
export const sessionIsQuick = cache(async (): Promise<boolean> => {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  return isQuickSessionId(await validatedSessionId(supabase))
})

/** For routes that need a Google (full) session. */
export async function assertFullSession(): Promise<void> {
  if (await sessionIsQuick()) throw Forbidden('quick_session')
}
