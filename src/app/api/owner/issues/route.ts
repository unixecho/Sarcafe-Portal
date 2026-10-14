import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError, BadRequest, NotFound } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { loadIssueReport, ISSUE_REPORT_DAYS } from '@/lib/checklists/issues-server'

const bodySchema = z.object({
  action: z.literal('resolve'),
  branchId: z.string().uuid(),
  itemId: z.string().min(1).max(100),
  note: z.string().max(300).optional(),
})

// The owner's "missing or not working" report: every NO answer in the checklists, grouped by what it was about,
// with who reported it, on which shift and when. One report per branch; marking a check handled closes the reports
// made so far (a new report opens it again).
export const GET = apiRoute(async (request: NextRequest) => {
  await requireOwner()
  const slug = request.nextUrl.searchParams.get('branch')
  if (!slug) throw BadRequest('בחרו סניף.')
  const service = createServiceRoleClient()
  const { data: branch } = await service.from('branches').select('id, slug, name').eq('slug', slug).eq('active', true).maybeSingle()
  if (!branch) throw NotFound('הסניף לא נמצא.')
  const report = await loadIssueReport(service, branch.id as string)
  return NextResponse.json({ branch: { id: branch.id, slug: branch.slug, name: branch.name }, days: ISSUE_REPORT_DAYS, ...report }, { headers: { 'Cache-Control': 'private, no-store' } })
})

export const POST = apiRoute(async (request: NextRequest) => {
  const owner = await requireOwner()
  const body = bodySchema.parse(await request.json())
  const service = createServiceRoleClient()
  const { data: branch } = await service.from('branches').select('id').eq('id', body.branchId).eq('active', true).maybeSingle()
  if (!branch) throw NotFound('הסניף לא נמצא.')
  const { error } = await service.from('checklist_issue_resolutions').insert({ branch_id: body.branchId, item_id: body.itemId, resolved_by: owner.id, note: body.note?.trim() || null })
  if (error) throw new ApiError(500, 'internal_error', 'לא הצלחנו לסמן כטופל. נסו שוב.')
  return NextResponse.json({ ok: true })
})
