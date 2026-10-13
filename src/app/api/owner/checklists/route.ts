import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError, BadRequest, NotFound } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { ensureChecklistTemplates, syncPublishedChecklists } from '@/lib/checklists/server'
import { staffColor } from '@/lib/shifts/people'
import { wallClockNow } from '@/lib/shifts/time'
import { isOp } from '@/lib/staff/access'

const itemSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(500),
  help: z.string().max(1000).optional(),
  kind: z.enum(['status', 'action', 'number']),
  issueType: z.enum(['inventory', 'cleanliness', 'equipment', 'cash', 'other']),
  required: z.boolean().optional(),
  target: z.number().finite().optional(),
  unit: z.string().max(20).optional(),
})
const definitionSchema = z.object({
  categories: z.array(z.object({ id: z.string().min(1).max(100), title: z.string().min(1).max(200), items: z.array(itemSchema).min(1).max(200) })).min(1).max(50),
})
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish'), branchId: z.string().uuid(), kind: z.enum(['opening', 'handover', 'closing']), name: z.string().min(1).max(200), definition: definitionSchema }),
  z.object({ action: z.literal('seen'), assignmentId: z.string().uuid() }),
  z.object({ action: z.literal('resolve'), assignmentId: z.string().uuid(), note: z.string().max(1000).optional() }),
])

export const GET = apiRoute(async (request: NextRequest) => {
  await requireOwner()
  const slug = request.nextUrl.searchParams.get('branch')
  if (!slug) throw BadRequest('בחרו סניף.')
  const service = createServiceRoleClient()
  const { data: branch } = await service.from('branches').select('id, slug, name, timezone').eq('slug', slug).eq('active', true).maybeSingle()
  if (!branch) throw NotFound('הסניף לא נמצא.')
  await ensureChecklistTemplates(service, branch)
  await syncPublishedChecklists(service, branch.id)

  const [{ data: templates }, { data: rows }] = await Promise.all([
    service.from('checklist_templates').select('id, kind, name, version, definition, published_at').eq('branch_id', branch.id).eq('active', true).order('kind'),
    service
      .from('checklist_assignments')
      .select('id, staff_id, shift_id, checklist_kind, status, issue_count, issues, submitted_at, manager_seen_at, manager_resolved_at, manager_note')
      .eq('branch_id', branch.id)
      .order('created_at', { ascending: false })
      .limit(150),
  ])
  const staffIds = [...new Set((rows ?? []).map((row) => row.staff_id as string).filter(Boolean))]
  const shiftIds = [...new Set((rows ?? []).map((row) => row.shift_id as string))]
  const [{ data: staff }, { data: shifts }, { data: rosterRows }] = await Promise.all([
    staffIds.length ? service.from('staff').select('id, display_name, first_name, last_name, handle, employee_no, employee_code').in('id', staffIds) : Promise.resolve({ data: [] }),
    shiftIds.length ? service.from('shifts').select('id, shift_date, start_time, end_time').in('id', shiftIds) : Promise.resolve({ data: [] }),
    // The scheduler's own roster for this branch, so a person has the same colour here as on the schedule.
    service.from('staff').select('id, branch_id, role, badge'),
  ])
  const roster = (rosterRows ?? [])
    .filter((row) => row.branch_id === null || row.branch_id === branch.id || isOp(row))
    .map((row) => ({ staffId: row.id as string }))
  const staffMap = new Map((staff ?? []).map((row) => [row.id as string, row]))
  const shiftMap = new Map((shifts ?? []).map((row) => [row.id as string, row]))
  const assignments = (rows ?? []).map((row) => {
    const person = staffMap.get(row.staff_id as string)
    const shift = shiftMap.get(row.shift_id as string)
    return {
      id: row.id,
      staffId: row.staff_id,
      staffColor: staffColor(row.staff_id as string, roster) ?? null,
      shiftId: row.shift_id,
      staffName: person?.display_name || [person?.first_name, person?.last_name].filter(Boolean).join(' ') || person?.handle || `עובד/ת ${person?.employee_code ?? person?.employee_no ?? ''}`.trim(),
      employeeNo: person?.employee_code ?? (person?.employee_no == null ? null : String(person.employee_no)),
      shiftDate: shift?.shift_date ?? '',
      startTime: shift?.start_time ?? '',
      endTime: shift?.end_time ?? '',
      kind: row.checklist_kind,
      status: row.status,
      issueCount: row.issue_count,
      issues: row.issues ?? [],
      submittedAt: row.submitted_at,
      seenAt: row.manager_seen_at,
      resolvedAt: row.manager_resolved_at,
      managerNote: row.manager_note,
    }
  })
  // Chronological, so the tracker can group by day; the 150-row cut above is by creation, not by date.
  assignments.sort((a, b) => a.shiftDate.localeCompare(b.shiftDate) || a.startTime.localeCompare(b.startTime) || ({ opening: 0, handover: 1, closing: 2 }[a.kind as 'opening'] - { opening: 0, handover: 1, closing: 2 }[b.kind as 'opening']))
  const serverNow = wallClockNow((branch.timezone as string | null) || 'Asia/Jerusalem')
  return NextResponse.json({ branch: { id: branch.id, slug: branch.slug, name: branch.name }, serverNow, templates: templates ?? [], assignments }, { headers: { 'Cache-Control': 'private, no-store' } })
})

export const POST = apiRoute(async (request: NextRequest) => {
  const owner = await requireOwner()
  const body = bodySchema.parse(await request.json())
  const service = createServiceRoleClient()
  if (body.action === 'publish') {
    const { data, error } = await service.rpc('publish_checklist_template', {
      p_actor: owner.id,
      p_branch_id: body.branchId,
      p_kind: body.kind,
      p_name: body.name,
      p_definition: body.definition,
    })
    if (error) {
      console.error('publish_checklist_template failed:', error.code)
      throw new ApiError(400, 'bad_request', 'לא הצלחנו לפרסם את הטופס. בדקו שכל הקטגוריות והבדיקות מלאות.')
    }
    return NextResponse.json({ ok: true, id: data })
  }

  const update =
    body.action === 'seen'
      ? { manager_seen_at: new Date().toISOString(), manager_seen_by: owner.id }
      : { manager_resolved_at: new Date().toISOString(), manager_resolved_by: owner.id, manager_note: body.note?.trim() || null, manager_seen_at: new Date().toISOString(), manager_seen_by: owner.id }
  const { error } = await service.from('checklist_assignments').update(update).eq('id', body.assignmentId)
  if (error) throw new ApiError(500, 'internal_error', 'לא הצלחנו לעדכן את הדיווח.')
  return NextResponse.json({ ok: true })
})
