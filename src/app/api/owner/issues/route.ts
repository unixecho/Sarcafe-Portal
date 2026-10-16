import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError, BadRequest, NotFound } from '@/lib/http/errors'
import { requireMenuEditor } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { loadShortageReport, ISSUE_REPORT_DAYS, GAP_REPORT_DAYS } from '@/lib/checklists/issues-server'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('resolve'), branchId: z.string().uuid(), itemId: z.string().min(1).max(100), note: z.string().max(300).optional() }),
  // A checklist nobody sent is closed ("not needed"): the same dismissal the shift tracker uses.
  z.object({ action: z.literal('closeGap'), branchId: z.string().uuid(), shiftId: z.string().uuid(), kind: z.enum(['opening', 'handover', 'closing']), note: z.string().max(300).optional() }),
])

// חוסרים ופערים: one report per branch holding what the checklists said is missing or not working (grouped by what it
// was about) and the checklists nobody sent. Owners see every branch; a general manager sees the branch they run
// (requireMenuEditor is the same per-branch rule the menu editor uses).
export const GET = apiRoute(async (request: NextRequest) => {
  const slug = request.nextUrl.searchParams.get('branch')
  if (!slug) throw BadRequest('בחרו סניף.')
  const service = createServiceRoleClient()
  const { data: branch } = await service.from('branches').select('id, slug, name').eq('slug', slug).eq('active', true).maybeSingle()
  if (!branch) throw NotFound('הסניף לא נמצא.')
  await requireMenuEditor(branch.id as string)
  const report = await loadShortageReport(service, branch.id as string)
  return NextResponse.json(
    { branch: { id: branch.id, slug: branch.slug, name: branch.name }, days: ISSUE_REPORT_DAYS, gapDays: GAP_REPORT_DAYS, serverTime: new Date().toISOString(), ...report },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = apiRoute(async (request: NextRequest) => {
  const body = bodySchema.parse(await request.json())
  const actor = await requireMenuEditor(body.branchId)
  const service = createServiceRoleClient()
  const { data: branch } = await service.from('branches').select('id').eq('id', body.branchId).eq('active', true).maybeSingle()
  if (!branch) throw NotFound('הסניף לא נמצא.')
  if (body.action === 'resolve') {
    const { error } = await service.from('checklist_issue_resolutions').insert({ branch_id: body.branchId, item_id: body.itemId, resolved_by: actor.id, note: body.note?.trim() || null })
    if (error) throw new ApiError(500, 'internal_error', 'לא הצלחנו לסמן כטופל. נסו שוב.')
    return NextResponse.json({ ok: true })
  }
  // closeGap: every unsent copy of that checklist of that shift follows, exactly like the tracker's dismiss.
  const { data: closed, error } = await service
    .from('checklist_assignments')
    .update({ manager_resolved_at: new Date().toISOString(), manager_resolved_by: actor.id, manager_note: body.note?.trim() || null })
    .eq('branch_id', body.branchId)
    .eq('shift_id', body.shiftId)
    .eq('checklist_kind', body.kind)
    .neq('status', 'submitted')
    .select('id')
  if (error) throw new ApiError(500, 'internal_error', 'לא הצלחנו לסגור את הפער. נסו שוב.')
  if (!closed || closed.length === 0) throw new ApiError(409, 'conflict', 'הצ׳קליסט כבר נשלח או נסגר.')
  return NextResponse.json({ ok: true, closed: closed.length })
})
