import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/owner/guard'
import { ApiError } from '@/lib/http/errors'
import { parseBody } from '@/lib/pos/server/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createStaffInvitation, credentialRoute, ONBOARDING_HEADERS } from '@/lib/staff/invitations'

type Context = { params: Promise<{ id: string }> }

export const GET = credentialRoute(async (_request: NextRequest, context: Context) => {
  await requireOwner()
  const id = z.string().uuid().parse((await context.params).id)
  const { data, error } = await createServiceRoleClient().from('staff_invitations')
    .select('created_at, expires_at, consumed_at, revoked_at').eq('staff_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new ApiError(500, 'internal_error', 'לא הצלחנו לטעון את מצב ההזמנה.')
  return NextResponse.json({ invitation: data }, { headers: ONBOARDING_HEADERS })
})

export const POST = credentialRoute(async (request: NextRequest, context: Context) => {
  const owner = await requireOwner()
  await parseBody(request, z.object({}).strict())
  const id = z.string().uuid().parse((await context.params).id)
  const invitation = await createStaffInvitation(owner.id, id, new URL(request.url).origin)
  return NextResponse.json({ invitation }, { headers: ONBOARDING_HEADERS })
})

export const DELETE = credentialRoute(async (request: NextRequest, context: Context) => {
  const owner = await requireOwner()
  await parseBody(request, z.object({}).strict())
  const id = z.string().uuid().parse((await context.params).id)
  const { data, error } = await createServiceRoleClient().rpc('staff_revoke_invitation', { p_actor: owner.id, p_staff: id })
  if (error || (data as { ok?: boolean })?.ok !== true) throw new ApiError(409, 'conflict', 'לא הצלחנו לבטל את הקישור. נסו שוב.')
  return NextResponse.json({ ok: true }, { headers: ONBOARDING_HEADERS })
})
