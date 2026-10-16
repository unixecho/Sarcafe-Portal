import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiError, Forbidden, Unauthorized } from '@/lib/http/errors'
import { parseBody } from '@/lib/pos/server/guard'
import { loadDevCentre, CENTRE_LIMIT } from '@/lib/push/dev-centre'
import { privateStaffRoute } from '@/lib/staff/records'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { isDeveloper } from '@/lib/checklists/developer'
import { createServiceRoleClient } from '@/lib/supabase/server'

// The developer's notification centre (components/staff/DevNotificationCenter.tsx): the developer's own inbox, sorted into
// three containers. The developer check is made again here: hiding the page is not access control.
const headers = { 'Cache-Control': 'private, no-store' }

async function requireDeveloper() {
  const me = await resolveStaffIdentity()
  if (!me) throw Unauthorized()
  if (!isDeveloper(me)) throw Forbidden('Developer access required.')
  return me
}

export const GET = privateStaffRoute(async () => {
  const me = await requireDeveloper()
  try {
    return NextResponse.json(await loadDevCentre(createServiceRoleClient(), me.id), { headers })
  } catch {
    throw new ApiError(503, 'unavailable', 'לא הצלחנו לטעון את ההתראות')
  }
})

export const POST = privateStaffRoute(async (request: NextRequest) => {
  const me = await requireDeveloper()
  const { ids } = await parseBody(request, z.object({ ids: z.array(z.string().uuid()).min(1).max(CENTRE_LIMIT) }).strict())
  const { error } = await createServiceRoleClient().from('schedule_notifications').update({ read_at: new Date().toISOString() }).eq('staff_id', me.id).is('read_at', null).in('id', ids)
  if (error) throw new ApiError(503, 'unavailable', 'לא הצלחנו לסמן כנקרא')
  return NextResponse.json({ ok: true }, { headers })
})
