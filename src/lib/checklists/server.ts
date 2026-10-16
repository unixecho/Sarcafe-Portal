import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { checklistName, defaultChecklistDefinition } from './defaults'
import { KIND_LABELS, type ChecklistAssignment, type ChecklistDefinition, type ChecklistKind } from './types'
import { isDismissed } from './window'

type Service = SupabaseClient
type BranchRow = { id: string; slug: string; name: { he?: string } | null }

export async function ensureChecklistTemplates(service: Service, branch: BranchRow, actorId?: string | null) {
  const { data: active } = await service.from('checklist_templates').select('kind').eq('branch_id', branch.id).eq('active', true)
  const { data: history } = await service.from('checklist_templates').select('kind, version').eq('branch_id', branch.id)
  const present = new Set((active ?? []).map((row) => row.kind as ChecklistKind))
  for (const kind of ['opening', 'handover', 'closing'] as const) {
    if (present.has(kind)) continue
    const { error } = await service.from('checklist_templates').insert({
      branch_id: branch.id,
      kind,
      name: checklistName(kind),
      version: Math.max(0, ...(history ?? []).filter((row) => row.kind === kind).map((row) => Number(row.version) || 0)) + 1,
      definition: defaultChecklistDefinition(kind, branch.slug),
      active: true,
      created_by: actorId ?? null,
    })
    // A simultaneous request may have won the partial unique index race.
    if (error && error.code !== '23505') throw error
  }
}

/** What each branch calls its forms: the name its builder gave the active form, keyed `<branchId>|<kind>`. A branch that never renamed
 *  one still has the standard name, and a branch with no form yet has no entry (callers fall back to KIND_LABELS). Employees read
 *  these names, so "whatever name they come up with in the builder" is what the shift card and the checklist list say. */
export async function checklistNames(service: Service, branchIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (branchIds.length === 0) return out
  const { data } = await service.from('checklist_templates').select('branch_id, kind, name').in('branch_id', [...new Set(branchIds)]).eq('active', true)
  for (const row of data ?? []) {
    const name = String(row.name ?? '').trim()
    if (name) out.set(`${row.branch_id}|${row.kind}`, name)
  }
  return out
}

export async function syncPublishedChecklists(service: Service, branchId: string) {
  const { data: weeks } = await service
    .from('schedule_weeks')
    .select('id')
    .eq('branch_id', branchId)
    .eq('status', 'published')
    .order('week_start', { ascending: false })
    .limit(8)
  await Promise.all((weeks ?? []).map((week) => service.rpc('sync_checklist_assignments', { p_week_id: week.id })))
}

export async function loadStaffChecklistAssignments(service: Service, branch: BranchRow, staffId: string): Promise<ChecklistAssignment[]> {
  const { data: rows, error } = await service
    .from('checklist_assignments')
    .select('id, branch_id, shift_id, shift_assignment_id, checklist_kind, template_version, template_snapshot, status, answers, issue_count, submitted_at, manager_resolved_at')
    .eq('branch_id', branch.id)
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  const shiftIds = [...new Set((rows ?? []).map((row) => row.shift_id as string))]
  const { data: shifts } = shiftIds.length
    ? await service.from('shifts').select('id, shift_date, start_time, end_time').in('id', shiftIds)
    : { data: [] as { id: string; shift_date: string; start_time: string; end_time: string }[] }
  const byShift = new Map((shifts ?? []).map((shift) => [shift.id as string, shift]))
  const covered = await coveredByFor(service, (rows ?? []).filter((row) => row.status === 'covered').map((row) => ({ shiftId: row.shift_id as string, kind: row.checklist_kind as string })))
  const names = await checklistNames(service, [branch.id])
  return (rows ?? [])
    .map((row): ChecklistAssignment | null => {
      const shift = byShift.get(row.shift_id as string)
      if (!shift) return null
      const kind = row.checklist_kind as ChecklistKind
      return {
        id: row.id as string,
        branchId: branch.id,
        branchName: branch.name?.he || branch.slug,
        shiftId: row.shift_id as string,
        shiftAssignmentId: row.shift_assignment_id as string,
        shiftDate: shift.shift_date as string,
        startTime: shift.start_time as string,
        endTime: shift.end_time as string,
        kind,
        kindLabel: names.get(`${branch.id}|${kind}`) ?? KIND_LABELS[kind],
        templateVersion: row.template_version as number,
        template: row.template_snapshot as ChecklistDefinition,
        status: row.status as ChecklistAssignment['status'],
        coveredBy: row.status === 'covered' ? covered.get(`${row.shift_id}|${row.checklist_kind}`) ?? null : undefined,
        dismissed: isDismissed({ status: row.status as string, resolvedAt: row.manager_resolved_at as string | null }),
        answers: (row.answers ?? {}) as ChecklistAssignment['answers'],
        issueCount: (row.issue_count as number) ?? 0,
        submittedAt: (row.submitted_at as string | null) ?? null,
      }
    })
    .filter((row): row is ChecklistAssignment => row !== null)
    .sort((a, b) => a.shiftDate.localeCompare(b.shiftDate) || a.startTime.localeCompare(b.startTime) || ({ opening: 0, handover: 1, closing: 2 }[a.kind] - { opening: 0, handover: 1, closing: 2 }[b.kind]))
}

/** The name a person goes by in a sentence (the owner screens use the same order). */
export const personLabel = (row: { display_name?: string | null; first_name?: string | null; last_name?: string | null; handle?: string | null } | undefined) =>
  row?.display_name || [row?.first_name, row?.last_name].filter(Boolean).join(' ') || row?.handle || 'עמית/ה'

/** The sentence for a person who tries to fill in a checklist somebody else is responsible for. */
export async function coveredMessage(service: Service, shiftId: string, kind: string): Promise<string> {
  const by = (await coveredByFor(service, [{ shiftId, kind }])).get(`${shiftId}|${kind}`)
  if (by?.reason === 'lead') return `${by.name} נבחר/ה למלא את הצ׳קליסטים של המשמרת הזו, אין צורך שתגישו.`
  if (by) return `הצ׳קליסט הזה כבר נשלח על ידי ${by.name} באותה משמרת, אין צורך להגיש אותו שוב.`
  return 'הצ׳קליסט הזה כבר מטופל על ידי מישהו אחר במשמרת, אין צורך להגיש אותו.'
}

/** For each covered (shift, kind): who sent it first, or who the owner picked instead. Keyed `<shiftId>|<kind>`. */
export async function coveredByFor(service: Service, wanted: { shiftId: string; kind: string }[]): Promise<Map<string, NonNullable<ChecklistAssignment['coveredBy']>>> {
  const out = new Map<string, NonNullable<ChecklistAssignment['coveredBy']>>()
  if (wanted.length === 0) return out
  const shiftIds = [...new Set(wanted.map((item) => item.shiftId))]
  const [{ data: sent }, { data: leads }] = await Promise.all([
    service.from('checklist_assignments').select('shift_id, checklist_kind, staff_id, submitted_at').in('shift_id', shiftIds).eq('status', 'submitted'),
    service.from('shift_assignments').select('shift_id, staff_id').in('shift_id', shiftIds).eq('checklist_lead', true),
  ])
  const peopleIds = [...new Set([...(sent ?? []).map((row) => row.staff_id as string | null), ...(leads ?? []).map((row) => row.staff_id as string | null)].filter((id): id is string => Boolean(id)))]
  const { data: people } = peopleIds.length ? await service.from('staff').select('id, display_name, first_name, last_name, handle').in('id', peopleIds) : { data: [] }
  const nameOf = new Map((people ?? []).map((row) => [row.id as string, personLabel(row)]))
  for (const item of wanted) {
    const key = `${item.shiftId}|${item.kind}`
    const first = (sent ?? []).find((row) => row.shift_id === item.shiftId && row.checklist_kind === item.kind)
    const lead = (leads ?? []).find((row) => row.shift_id === item.shiftId)
    if (first) out.set(key, { name: nameOf.get(first.staff_id as string) ?? 'עמית/ה', at: (first.submitted_at as string | null) ?? null, reason: 'submitted' })
    else if (lead) out.set(key, { name: nameOf.get(lead.staff_id as string) ?? 'עמית/ה', at: null, reason: 'lead' })
  }
  return out
}

export function flattenDefinition(definition: ChecklistDefinition) {
  return definition.categories.flatMap((category) => category.items.map((item) => ({ ...item, categoryId: category.id, categoryTitle: category.title })))
}
