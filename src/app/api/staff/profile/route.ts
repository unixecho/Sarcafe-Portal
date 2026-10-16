import { NextResponse, type NextRequest } from 'next/server'
import { BadRequest, Forbidden } from '@/lib/http/errors'
import { privateStaffRoute } from '@/lib/staff/records'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { validateProfile } from '@/lib/staff/profile'
import { createServiceRoleClient } from '@/lib/supabase/server'

// The employee's own details (the onboarding wizard's "my details" step): first and last name, phone, avatar emoji.
// It edits ONLY the row of whoever the session says they are, and only those four fields: never role, badge, branch,
// active, e-mail or employee number, whatever the body says. A code-login session is enough (the wizard runs right after
// the personal code is set, before any Google link).
export const PATCH = privateStaffRoute(async (request: NextRequest) => {
  const staff = await resolveStaffIdentity()
  if (!staff) throw Forbidden('צריך להתחבר כדי לעדכן את הפרטים.')
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') throw BadRequest('הבקשה אינה תקינה.')
  const result = validateProfile(body as Record<string, unknown>)
  if (!result.ok) throw BadRequest(result.message)
  const { error } = await createServiceRoleClient().from('staff').update(result.value).eq('id', staff.id)
  if (error) throw error
  return NextResponse.json({ ok: true, saved: { firstName: result.value.first_name, lastName: result.value.last_name, phone: result.value.phone ?? null, emoji: result.value.avatar_emoji ?? null } })
})
