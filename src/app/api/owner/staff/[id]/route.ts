import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { refusal } from '@/lib/shifts/dispatch-write'

// One person's detail, for the edit sheet: the things the list does not carry —
// can this record be deleted at all (has it any history?), how many shifts is
// the person still on, and the trail of who changed what. Owner only.
const idSchema = z.string().uuid()

type Ctx = { params: Promise<{ id: string }> }

export const GET = apiRoute(async (_request: NextRequest, ctx: Ctx) => {
  await requireOwner()
  const { id } = await ctx.params
  const staffId = idSchema.parse(id)
  const service = createServiceRoleClient()

  const [{ data: history }, { data: future }, { data: trail }] = await Promise.all([
    service.rpc('staff_has_history', { p_staff: staffId }),
    service.rpc('sched_staff_future_count', { p_staff: staffId }),
    service
      .from('staff_audit')
      .select('id, actor_name, action, summary, created_at')
      .eq('staff_id', staffId)
      .order('created_at', { ascending: false })
      .limit(15),
  ])

  return NextResponse.json({
    hasHistory: history === true,
    futureShifts: typeof future === 'number' ? future : 0,
    audit: (trail ?? []).map((r) => ({
      id: String(r.id),
      actorName: r.actor_name as string | null,
      summary: r.summary as string | null,
      createdAt: r.created_at as string,
    })),
  })
})

// Permanent removal — ONLY for a record with no history (nothing scheduled, no
// requests, never signed in, no orders). Anything else must be deactivated, which
// keeps every shift, request and record intact.
export const DELETE = apiRoute(async (_request: NextRequest, ctx: Ctx) => {
  const owner = await requireOwner()
  const { id } = await ctx.params
  const staffId = idSchema.parse(id)
  const service = createServiceRoleClient()

  const { data, error } = await service.rpc('sched_delete_staff', { p_actor: owner.id, p_staff: staffId })
  if (error) {
    console.error('sched_delete_staff failed:', error.code)
    throw new ApiError(500, 'internal_error', 'משהו השתבש אצלנו. נסו שוב בעוד רגע.')
  }
  const res = data as { ok?: boolean; reason?: string; details?: Record<string, unknown> }
  if (res.ok !== true) throw refusal(res.reason ?? 'bad_request', res.details ?? {})
  return NextResponse.json({ ok: true })
})
