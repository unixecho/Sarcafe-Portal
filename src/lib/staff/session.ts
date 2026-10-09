import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isStaff, type AccessRow } from '@/lib/staff/access'
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

export async function resolveStaffIdentity(): Promise<StaffIdentity | null> {
  const service = createServiceRoleClient()
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data } = await service.from('staff').select(STAFF_COLUMNS).eq('auth_user_id', user.id).eq('active', true).maybeSingle()
    if (isStaff(data)) {
      const quick = await validatedSessionId(supabase).then(isQuickSessionId).catch(() => true)
      return identity(data as Record<string, unknown>, 'google', quick)
    }
  }

  const token = (await cookies()).get(EMPLOYEE_SESSION_COOKIE)?.value
  if (!token) return null
  const hash = employeeSessionHash(token)
  const { data: session } = await service
    .from('staff_employee_sessions')
    .select('staff_id, expires_at, revoked_at')
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (!session) return null

  const { data } = await service.from('staff').select(STAFF_COLUMNS).eq('id', session.staff_id).eq('active', true).maybeSingle()
  if (!isStaff(data)) return null
  void service.from('staff_employee_sessions').update({ last_seen_at: new Date().toISOString() }).eq('token_hash', hash)
  return identity(data as Record<string, unknown>, 'employee_code', true)
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
