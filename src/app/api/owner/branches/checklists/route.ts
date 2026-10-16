import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError, NotFound } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  branchId: z.string().uuid(),
  kind: z.enum(['opening', 'handover', 'closing']),
  enabled: z.boolean(),
}).strict()

// The owner switches one checklist (opening / handover / closing) on or off for ONE branch. The database does the work
// atomically (checklist_set_branch_kind): forms nobody has started are removed from the days that have not passed,
// started ones are closed with a reason, sent ones stay as evidence. Owner-only: this changes what the whole team is asked.
export const POST = apiRoute(async (request: Request) => {
  const owner = await requireOwner()
  const body = bodySchema.parse(await request.json())
  const service = createServiceRoleClient()
  const { data: branch } = await service.from('branches').select('id').eq('id', body.branchId).eq('active', true).maybeSingle()
  if (!branch) throw NotFound('הסניף לא נמצא.')
  const { data, error } = await service.rpc('checklist_set_branch_kind', { p_actor: owner.id, p_branch: body.branchId, p_kind: body.kind, p_enabled: body.enabled })
  if (error) {
    console.error('checklist_set_branch_kind failed:', error.code, String(error.message ?? '').slice(0, 160))
    throw new ApiError(500, 'internal_error', 'לא הצלחנו לשנות את הצ׳קליסט. נסו שוב.')
  }
  const result = data as { ok?: boolean; reason?: string; removed?: number; closed?: number } | null
  if (!result?.ok) throw new ApiError(result?.reason === 'forbidden' ? 403 : 400, result?.reason === 'forbidden' ? 'forbidden' : 'bad_request', 'לא ניתן לשנות את הצ׳קליסט הזה.')
  const { data: rows } = await service.from('checklist_branch_settings').select('kind, enabled, disabled_from').eq('branch_id', body.branchId)
  return NextResponse.json({ ok: true, removed: result.removed ?? 0, closed: result.closed ?? 0, settings: rows ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } })
})
