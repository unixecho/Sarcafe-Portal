import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError, BadRequest, NotFound } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { ensureChecklistTemplates, syncPublishedChecklists } from '@/lib/checklists/server'
import { isDismissed } from '@/lib/checklists/window'
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
  // An owner closes a checklist nobody sent ("not needed"), and can take it back. See isDismissed in window.ts.
  z.object({ action: z.literal('dismiss'), assignmentId: z.string().uuid(), note: z.string().max(300).optional() }),
  z.object({ action: z.literal('restore'), assignmentId: z.string().uuid() }),
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
      .select('id, staff_id, shift_id, shift_assignment_id, checklist_kind, status, issue_count, issues, submitted_at, manager_seen_at, manager_resolved_at, manager_note')
      .eq('branch_id', branch.id)
      // A covered copy is a colleague's duplicate of a checklist somebody else sends: nothing for the owner to track.
      .neq('status', 'covered')
      .order('created_at', { ascending: false })
      .limit(150),
  ])
  const staffIds = [...new Set((rows ?? []).map((row) => row.staff_id as string).filter(Boolean))]
  const shiftIds = [...new Set((rows ?? []).map((row) => row.shift_id as string))]
  const [{ data: staff }, { data: shifts }, { data: rosterRows }, { data: leadRows }] = await Promise.all([
    staffIds.length ? service.from('staff').select('id, display_name, first_name, last_name, handle, employee_no, employee_code').in('id', staffIds) : Promise.resolve({ data: [] }),
    shiftIds.length ? service.from('shifts').select('id, shift_date, start_time, end_time').in('id', shiftIds) : Promise.resolve({ data: [] }),
    // The scheduler's own roster for this branch, so a person has the same colour here as on the schedule.
    service.from('staff').select('id, branch_id, role, badge'),
    // The person the owner picked to do a shift's checklists (when two or more work it).
    shiftIds.length ? service.from('shift_assignments').select('id').in('shift_id', shiftIds).eq('checklist_lead', true) : Promise.resolve({ data: [] }),
  ])
  const leadAssignmentIds = new Set((leadRows ?? []).map((row) => row.id as string))
  const roster = (rosterRows ?? [])
    .filter((row) => row.branch_id === null || row.branch_id === branch.id || isOp(row))
    .map((row) => ({ staffId: row.id as string }))
  const staffMap = new Map((staff ?? []).map((row) => [row.id as string, row]))
  const shiftMap = new Map((shifts ?? []).map((row) => [row.id as string, row]))
  const mapped = (rows ?? []).map((row) => {
    const person = staffMap.get(row.staff_id as string)
    const shift = shiftMap.get(row.shift_id as string)
    return {
      id: row.id,
      ids: [row.id as string],
      lead: leadAssignmentIds.has(row.shift_assignment_id as string),
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
      dismissed: isDismissed({ status: row.status as string, resolvedAt: row.manager_resolved_at as string | null }),
      issueCount: row.issue_count,
      issues: row.issues ?? [],
      submittedAt: row.submitted_at,
      seenAt: row.manager_seen_at,
      resolvedAt: row.manager_resolved_at,
      managerNote: row.manager_note,
    }
  })
  // One checklist of one shift is ONE line, however many people could still send it. When one of them sent it, that
  // is the line; when nobody has (no lead picked, two people on the shift), the people are named together, and
  // dismissing it dismisses it for all of them.
  const byChecklist = new Map<string, typeof mapped>()
  for (const row of mapped) {
    const key = `${row.shiftId}|${row.kind}`
    byChecklist.set(key, [...(byChecklist.get(key) ?? []), row])
  }
  const assignments = [...byChecklist.values()].map((group) => {
    const sent = group.find((row) => row.status === 'submitted')
    if (sent) return sent
    const sorted = [...group].sort((a, b) => String(a.id).localeCompare(String(b.id)))
    if (sorted.length === 1) return sorted[0]!
    const first = sorted[0]!
    return { ...first, ids: sorted.map((row) => row.id as string), lead: sorted.some((row) => row.lead), staffName: sorted.map((row) => row.staffName).join(' · '), issueCount: 0 }
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

  if (body.action === 'dismiss' || body.action === 'restore') {
    const { data: row } = await service.from('checklist_assignments').select('id, status, shift_id, checklist_kind').eq('id', body.assignmentId).maybeSingle()
    if (!row) throw NotFound('הצ׳קליסט לא נמצא.')
    // A sent checklist is a record, not a request: there is nothing to dismiss, and its "handled" mark is a different thing.
    if (row.status === 'submitted') throw new ApiError(409, 'conflict', 'הצ׳קליסט כבר נשלח, אין מה לבטל.')
    const change =
      body.action === 'dismiss'
        ? { manager_resolved_at: new Date().toISOString(), manager_resolved_by: owner.id, manager_note: body.note?.trim() || null }
        : { manager_resolved_at: null, manager_resolved_by: null, manager_note: null }
    // The same checklist of the same shift is one thing to the owner: every unsent copy of it follows.
    const { error } = await service.from('checklist_assignments').update(change).eq('shift_id', row.shift_id as string).eq('checklist_kind', row.checklist_kind as string).neq('status', 'submitted')
    if (error) throw new ApiError(500, 'internal_error', 'לא הצלחנו לעדכן את הצ׳קליסט.')
    return NextResponse.json({ ok: true, dismissed: body.action === 'dismiss' })
  }

  const update =
    body.action === 'seen'
      ? { manager_seen_at: new Date().toISOString(), manager_seen_by: owner.id }
      : { manager_resolved_at: new Date().toISOString(), manager_resolved_by: owner.id, manager_note: body.note?.trim() || null, manager_seen_at: new Date().toISOString(), manager_seen_by: owner.id }
  const { error } = await service.from('checklist_assignments').update(update).eq('id', body.assignmentId)
  if (error) throw new ApiError(500, 'internal_error', 'לא הצלחנו לעדכן את הדיווח.')
  return NextResponse.json({ ok: true })
})
