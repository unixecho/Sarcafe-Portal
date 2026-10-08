import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { validatedSessionId } from '@/lib/pos/server/quick-login'
import { revokeEmployeeSession } from '@/lib/staff/session'

export async function POST() {
  const supabase = await createServerSupabaseClient()
  const response = NextResponse.json({ ok: true })
  await revokeEmployeeSession(response)

  // A quick-login session (employee number + passcode) belongs to ONE tablet: ending it
  // must not sign the person out of their own phone, so only this session is revoked
  // (the default scope would revoke every session of the account), and its marker row is
  // retained until the conservative sweep so a failed revocation can never make the
  // same token look like a full session. Best-effort: signing out comes first.
  let scope: 'global' | 'local' = 'global'
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const sessionId = user ? await validatedSessionId(supabase) : null
    if (sessionId) {
      const { data } = await createServiceRoleClient().from('pos_quick_sessions').select('session_id').eq('session_id', sessionId).maybeSingle()
      if (data) scope = 'local'
    }
  } catch {
    /* fall through to a normal sign-out */
  }

  const { error } = await supabase.auth.signOut({ scope })

  if (error && error.name !== 'AuthSessionMissingError') {
    return NextResponse.json({ error: { code: 'signout_failed', message: error.message } }, { status: 500 })
  }
  return response
}
