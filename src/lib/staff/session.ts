import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { cache } from 'react'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isStaff, type AccessRow } from '@/lib/staff/access'
import { ApiError, Unauthorized } from '@/lib/http/errors'
import { isQuickSessionId, validatedSessionId } from '@/lib/pos/server/quick-login'

export const EMPLOYEE_SESSION_COOKIE = 'sarcafe_staff_session'
const SESSION_DAYS = 30

export type StaffIdentity = AccessRow & {
  id: string
  auth_user_id: string | null
  email: string | null
  display_name: string | null
  first_name: string | null
  last_name: string | null
  employee_no: string | null
  via: 'google' | 'employee_code'
  quick: boolean
}

export const employeeSessionHash = (token: string) => createHash('sha256').update(token).digest('hex')

const STAFF_COLUMNS = 'id, auth_user_id, role, badge, branch_id, active, email, display_name, first_name, last_name, employee_no, employee_code'

function identity(row: Record<string, unknown>, via: StaffIdentity['via'], quick: boolean): StaffIdentity {
  const { employee_code, ...rest } = row
  return { ...(rest as Omit<StaffIdentity, 'via' | 'quick'>), employee_no: employee_code == null ? (row.employee_no == null ? null : String(row.employee_no)) : String(employee_code), via, quick }
}

// Once per request (React cache): the layout, the page and the views all ask who is signed in, and each answer is up to four
// round trips to Supabase (auth, the staff row, the session check). Outside a server render (an API route) it simply runs.
// `failed`: the check itself could not be made (the auth server or the database did not answer). That is not "nobody is signed
// in": requireStaffIdentity answers it with 503, so nobody is told to sign in again because of an outage.
type IdentityLookup = { me: StaffIdentity | null; failed: boolean }
const authFailed = (error: unknown) => {
  if (!error) return false
  const status = (error as { status?: unknown }).status
  return isAuthRetryableFetchError(error) || (typeof status === 'number' && status >= 500)
}

const lookupIdentity = cache(async function lookupIdentity(): Promise<IdentityLookup> {
  const service = createServiceRoleClient()
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  let failed = authFailed(authError)

  if (user) {
    const { data, error } = await service.from('staff').select(STAFF_COLUMNS).eq('auth_user_id', user.id).eq('active', true).maybeSingle()
    if (error) failed = true
    if (isStaff(data)) {
      const quick = await validatedSessionId(supabase).then(isQuickSessionId).catch(() => true)
      return { me: identity(data as Record<string, unknown>, 'google', quick), failed: false }
    }
  }

  const token = (await cookies()).get(EMPLOYEE_SESSION_COOKIE)?.value
  if (!token) return { me: null, failed }
  const hash = employeeSessionHash(token)
  const { data: session, error: sessionError } = await service
    .from('staff_employee_sessions')
    .select('staff_id, expires_at, revoked_at')
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (sessionError) return { me: null, failed: true }
  if (!session) return { me: null, failed }

  const { data, error } = await service.from('staff').select(STAFF_COLUMNS).eq('id', session.staff_id).eq('active', true).maybeSingle()
  if (error) return { me: null, failed: true }
  if (!isStaff(data)) return { me: null, failed }
  void service.from('staff_employee_sessions').update({ last_seen_at: new Date().toISOString() }).eq('token_hash', hash)
  return { me: identity(data as Record<string, unknown>, 'employee_code', true), failed: false }
})

/** Who is signed in, or null (also null when it could not be checked: pages then send to sign in, as before). */
export const resolveStaffIdentity = cache(async function resolveStaffIdentity(): Promise<StaffIdentity | null> {
  return (await lookupIdentity()).me
})

/** For API routes: the person, or 503 when it could not be checked (an outage is not a sign-out), or `missing()` (default 401)
 *  when nobody is signed in — each route keeps its own words for that. */
export async function requireStaffIdentity(missing: () => Error = () => Unauthorized()): Promise<StaffIdentity> {
  const { me, failed } = await lookupIdentity()
  if (me) return me
  if (failed) throw new ApiError(503, 'unavailable', 'לא הצלחנו לבדוק את ההרשאה כרגע. נסו שוב בעוד רגע.')
  throw missing()
}

export async function issueEmployeeSession(response: NextResponse, staffId: string) {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  const service = createServiceRoleClient()
  const { error } = await service.from('staff_employee_sessions').insert({
    token_hash: employeeSessionHash(token),
    staff_id: staffId,
    expires_at: expires.toISOString(),
  })
  if (error) throw error
  response.cookies.set(EMPLOYEE_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  })
}

export async function revokeEmployeeSession(response: NextResponse) {
  const token = (await cookies()).get(EMPLOYEE_SESSION_COOKIE)?.value
  if (token) {
    await createServiceRoleClient()
      .from('staff_employee_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', employeeSessionHash(token))
  }
  response.cookies.set(EMPLOYEE_SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
}
