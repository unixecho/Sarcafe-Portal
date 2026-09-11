import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { Unauthorized, Forbidden } from '@/lib/http/errors'
import { isStaff, type AccessRow } from '@/lib/staff/access'

// Being signed in with Google is NOT being staff — anyone with a Google
// account can authenticate against this project (see /login and
// middleware.ts). Every route that requires staff-level trust must call
// this, never just check for a session.
export async function requireStaff(): Promise<AccessRow & { id: string; auth_user_id: string }> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw Unauthorized()

  // Service role: RLS on `staff` intentionally does not grant a row read
  // to the row's own owner (staff shouldn't be able to read their own
  // role/badge columns directly and reason about privilege escalation from
  // the client) — every authorization decision is resolved server-side.
  const service = createServiceRoleClient()
  const { data: row } = await service
    .from('staff')
    .select('id, auth_user_id, role, badge, branch_id, active')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle()

  if (!isStaff(row)) throw Forbidden('This account is not staff.')

  return row as AccessRow & { id: string; auth_user_id: string }
}
