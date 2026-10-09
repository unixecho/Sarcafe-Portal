import { NextResponse, type NextRequest } from 'next/server'
import { BadRequest, Forbidden } from '@/lib/http/errors'
import { privateStaffRoute } from '@/lib/staff/records'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { isStaffAvatar } from '@/lib/staff/avatar'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const POST = privateStaffRoute(async (request: NextRequest) => {
  const staff = await resolveStaffIdentity()
  if (!staff) throw Forbidden('צריך להתחבר כדי לבחור אווטאר.')
  const body = await request.json().catch(() => null)
  if (!isStaffAvatar(body?.emoji)) throw BadRequest('בחרו אווטאר מהרשימה.')

  const { error } = await createServiceRoleClient().from('staff').update({ avatar_emoji: body.emoji }).eq('id', staff.id)
  if (error) throw error
  return NextResponse.json({ emoji: body.emoji })
})
