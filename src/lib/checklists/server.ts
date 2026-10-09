import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { checklistName, defaultChecklistDefinition } from './defaults'
import { KIND_LABELS, type ChecklistAssignment, type ChecklistDefinition, type ChecklistKind } from './types'

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
    .select('id, branch_id, shift_id, shift_assignment_id, checklist_kind, template_version, template_snapshot, status, answers, issue_count, submitted_at')
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
  return (rows ?? [])
    .map((row) => {
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
        kindLabel: KIND_LABELS[kind],
        templateVersion: row.template_version as number,
        template: row.template_snapshot as ChecklistDefinition,
        status: row.status as ChecklistAssignment['status'],
        answers: (row.answers ?? {}) as ChecklistAssignment['answers'],
        issueCount: (row.issue_count as number) ?? 0,
        submittedAt: (row.submitted_at as string | null) ?? null,
      }
    })
    .filter((row): row is ChecklistAssignment => row !== null)
    .sort((a, b) => a.shiftDate.localeCompare(b.shiftDate) || a.startTime.localeCompare(b.startTime) || ({ opening: 0, handover: 1, closing: 2 }[a.kind] - { opening: 0, handover: 1, closing: 2 }[b.kind]))
}

export function flattenDefinition(definition: ChecklistDefinition) {
  return definition.categories.flatMap((category) => category.items.map((item) => ({ ...item, categoryId: category.id, categoryTitle: category.title })))
}
