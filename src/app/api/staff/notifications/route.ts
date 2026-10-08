import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiError, Unauthorized } from '@/lib/http/errors'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { parseBody } from '@/lib/pos/server/guard'
import { privateStaffRoute } from '@/lib/staff/records'

const headers = { 'Cache-Control': 'private, no-store' }
export const GET = privateStaffRoute(async () => {
  const me = await resolveStaffIdentity()
  if (!me) throw Unauthorized()
  const service = createServiceRoleClient()
  const [items, count] = await Promise.all([
    service.from('schedule_notifications').select('id, title, body, created_at, read_at').eq('staff_id', me.id).order('created_at', { ascending: false }).limit(40),
    service.from('schedule_notifications').select('id', { count: 'exact', head: true }).eq('staff_id', me.id).is('read_at', null),
  ])
  if (items.error || count.error) throw new ApiError(503, 'unavailable', 'לא הצלחנו לטעון את העדכונים')
  return NextResponse.json({ notifications: items.data ?? [], unread: count.count ?? 0 }, { headers })
})
export const POST = privateStaffRoute(async (request: NextRequest) => {
  const me = await resolveStaffIdentity()
  if (!me) throw Unauthorized()
  const { ids } = await parseBody(request, z.object({ ids: z.array(z.string().uuid()).min(1).max(40) }).strict())
  const { error } = await createServiceRoleClient().from('schedule_notifications').update({ read_at: new Date().toISOString() }).eq('staff_id', me.id).is('read_at', null).in('id', ids)
  if (error) throw new ApiError(503, 'unavailable', 'לא הצלחנו לסמן כנקרא')
  return NextResponse.json({ ok: true }, { headers })
})
