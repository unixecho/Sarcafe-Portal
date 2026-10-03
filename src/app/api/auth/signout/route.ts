import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { validatedSessionId } from '@/lib/pos/server/quick-login'

export async function POST() {
  const supabase = await createServerSupabaseClient()

  // A quick-login session (employee number + passcode) belongs to ONE tablet: ending it
  // must not sign the person out of their own phone, so only this session is revoked
  // (the default scope would revoke every session of the account), and its marker row is
  // removed rather than left for the daily sweep. Best-effort: signing out comes first.
  let scope: 'global' | 'local' = 'global'
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const sessionId = user ? await validatedSessionId(supabase) : null
    if (sessionId) {
      const { data } = await createServiceRoleClient().from('pos_quick_sessions').delete().eq('session_id', sessionId).select('session_id')
      if (data && data.length > 0) scope = 'local'
    }
  } catch {
    /* fall through to a normal sign-out */
  }

  const { error } = await supabase.auth.signOut({ scope })

  if (error) {
    return NextResponse.json({ error: { code: 'signout_failed', message: error.message } }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
