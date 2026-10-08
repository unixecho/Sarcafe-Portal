import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError, BadRequest, Forbidden, NotFound, Unauthorized } from '@/lib/http/errors'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { ensureChecklistTemplates, flattenDefinition, loadStaffChecklistAssignments, syncPublishedChecklists } from '@/lib/checklists/server'
import { KIND_LABELS, type ChecklistAnswer, type ChecklistDefinition } from '@/lib/checklists/types'
import { isChecklistDeveloper } from '@/lib/checklists/developer'
import { parseBody } from '@/lib/pos/server/guard'
import { checkCredentialRateLimit, credentialFingerprint, clientIp } from '@/lib/rate-limit'

const answerSchema = z.record(
  z.object({
    result: z.enum(['ok', 'issue']),
    reason: z.string().max(1000).optional(),
    value: z.number().finite().optional(),
    answeredAt: z.string().datetime(),
  })
)

const writeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), assignmentId: z.string().uuid(), answers: answerSchema }),
  z.object({ action: z.literal('submit'), assignmentId: z.string().uuid(), answers: answerSchema, attested: z.literal(true) }),
  z.object({ action: z.literal('profile_email'), email: z.string().email().max(255) }),
  z.object({ action: z.literal('change_passcode'), currentPasscode: z.string().regex(/^\d{6}$/), newPasscode: z.string().regex(/^\d{6}$/) }),
])

async function branchForRequest(request: NextRequest, staff: NonNullable<Awaited<ReturnType<typeof resolveStaffIdentity>>>) {
  const slug = request.nextUrl.searchParams.get('branch')
  if (!slug) throw BadRequest('בחרו סניף.')
  const service = createServiceRoleClient()
  const { data: branch } = await service.from('branches').select('id, slug, name').eq('slug', slug).eq('active', true).maybeSingle()
  if (!branch) throw NotFound('הסניף לא נמצא.')
  if (staff.branch_id && staff.branch_id !== branch.id) throw Forbidden('אין גישה לסניף הזה.')
  return branch as { id: string; slug: string; name: { he?: string } | null }
}

export const GET = apiRoute(async (request: NextRequest) => {
  const staff = await resolveStaffIdentity()
  if (!staff) throw Unauthorized('יש להתחבר כדי לראות צ׳קליסטים.')
  const service = createServiceRoleClient()
  const branch = await branchForRequest(request, staff)
  await ensureChecklistTemplates(service, branch, staff.id)
  await syncPublishedChecklists(service, branch.id)
  const assignments = await loadStaffChecklistAssignments(service, branch, staff.id)
  const developerMode = isChecklistDeveloper(staff.email)
  const { data: previewRows } = developerMode
    ? await service
        .from('checklist_templates')
        .select('id, kind, name, version, definition')
        .eq('branch_id', branch.id)
        .eq('active', true)
        .order('kind')
    : { data: [] }
  const previews = (previewRows ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind,
    kindLabel: KIND_LABELS[row.kind as keyof typeof KIND_LABELS],
    name: row.name,
    version: row.version,
    definition: row.definition,
  }))
  const label = staff.display_name || [staff.first_name, staff.last_name].filter(Boolean).join(' ') || `עובד/ת ${staff.employee_no ?? ''}`.trim()
  return NextResponse.json(
    { profile: { id: staff.id, label, email: staff.email, employeeNo: staff.employee_no, via: staff.via }, assignments, developerMode, previews },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = apiRoute(async (request: NextRequest) => {
  const staff = await resolveStaffIdentity()
  if (!staff) throw Unauthorized('יש להתחבר כדי לעדכן צ׳קליסט.')
  const body = await parseBody(request, writeSchema)
  const service = createServiceRoleClient()

  if (body.action === 'change_passcode') {
    const allowed = await Promise.all([
      checkCredentialRateLimit(`self-pin:${credentialFingerprint(staff.id)}`, 5, 900),
      checkCredentialRateLimit(`self-pin-ip:${credentialFingerprint(clientIp(request))}`, 15, 900),
    ])
    if (allowed.some((value) => !value)) throw new ApiError(429, 'rate_limited', 'יותר מדי ניסיונות. חכו כמה דקות ונסו שוב.')
    if (!staff.employee_no) throw BadRequest('לא נמצא מספר עובד לחשבון הזה.')
    const { data: verified, error: verifyError } = await service.rpc('pos_verify_pin', { p_employee_no: staff.employee_no, p_pin: body.currentPasscode })
    const check = verified as { ok?: boolean; staff_id?: string } | null
    if (verifyError || check?.ok !== true || check.staff_id !== staff.id) throw new ApiError(401, 'unauthorized', 'הקוד הנוכחי אינו נכון.')
    const { data: changed, error: changeError } = await service.rpc('pos_set_pin', { p_actor: staff.id, p_target: staff.id, p_pin: body.newPasscode })
    const result = changed as { ok?: boolean; reason?: string } | null
    if (changeError || result?.ok !== true) {
      if (result?.reason === 'weak') throw new ApiError(400, 'bad_request', 'הקוד החדש קל מדי לניחוש. בחרו קוד אחר.')
      throw new ApiError(400, 'bad_request', 'לא הצלחנו לשנות את הקוד.')
    }
    return NextResponse.json({ ok: true, signInAgain: true }, { headers: { 'Cache-Control': 'private, no-store' } })
  }

  if (body.action === 'profile_email') {
    const { data: duplicate } = await service.from('staff').select('id').ilike('email', body.email).neq('id', staff.id).maybeSingle()
    if (duplicate) throw new ApiError(409, 'conflict', 'האימייל הזה כבר משויך לעובד/ת אחר/ת.')
    const { error } = await service.from('staff').update({ email: body.email.trim().toLowerCase() }).eq('id', staff.id).is('auth_user_id', null)
    if (error) throw new ApiError(400, 'bad_request', 'לא הצלחנו לשמור את האימייל.')
    return NextResponse.json({ ok: true })
  }

  const { data: row } = await service
    .from('checklist_assignments')
    .select('id, staff_id, status, template_snapshot')
    .eq('id', body.assignmentId)
    .maybeSingle()
  if (!row) throw NotFound('הצ׳קליסט לא נמצא.')
  if (row.staff_id !== staff.id) throw Forbidden('הצ׳קליסט שייך לעובד/ת אחר/ת.')
  if (row.status === 'submitted') throw new ApiError(409, 'conflict', 'הצ׳קליסט כבר נשלח.')

  if (body.action === 'save') {
    const { error } = await service
      .from('checklist_assignments')
      .update({ answers: body.answers, status: 'in_progress', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('staff_id', staff.id)
      .neq('status', 'submitted')
    if (error) throw new ApiError(500, 'internal_error', 'לא הצלחנו לשמור. נסו שוב.')
    return NextResponse.json({ ok: true })
  }

  const items = flattenDefinition(row.template_snapshot as ChecklistDefinition)
  const missing = items.filter((item) => item.required !== false && !body.answers[item.id])
  if (missing.length) throw new ApiError(400, 'incomplete', 'צריך לענות על כל הבדיקות לפני השליחה.', { items: missing.map((item) => item.id) })
  const issues = items.flatMap((item) => {
    const answer = body.answers[item.id] as ChecklistAnswer | undefined
    const numberMismatch = item.kind === 'number' && item.target !== undefined && answer?.value !== item.target
    if (!answer || (answer.result !== 'issue' && !numberMismatch)) return []
    const reason = answer.reason?.trim()
    if (!reason) throw new ApiError(400, 'reason_required', `חסרה סיבה: ${item.label}`, { itemId: item.id })
    return [{ itemId: item.id, label: item.label, category: item.categoryTitle, type: item.issueType, reason, value: answer.value, target: item.target }]
  })
  const now = new Date().toISOString()
  const { error } = await service
    .from('checklist_assignments')
    .update({
      answers: body.answers,
      issues,
      issue_count: issues.length,
      has_inventory_issue: issues.some((issue) => issue.type === 'inventory'),
      has_cleanliness_issue: issues.some((issue) => issue.type === 'cleanliness'),
      attested: true,
      status: 'submitted',
      submitted_at: now,
      updated_at: now,
    })
    .eq('id', row.id)
    .eq('staff_id', staff.id)
    .neq('status', 'submitted')
  if (error) throw new ApiError(500, 'internal_error', 'השליחה לא הושלמה. נסו שוב.')
  return NextResponse.json({ ok: true, issueCount: issues.length })
})
