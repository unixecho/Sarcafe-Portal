import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { personLabel } from './server'
import { buildIssueReport, type IssueReport, type IssueSource } from './issues'
import type { ChecklistKind } from './types'

type Service = SupabaseClient

/** How far back the report looks. A check that was reported and never fixed keeps appearing as long as it stays in this window. */
export const ISSUE_REPORT_DAYS = 45

/** The branch's open "missing / not working" report, built from the submitted checklists of the last ISSUE_REPORT_DAYS days
 *  and the owner's "handled" marks (checklist_issue_resolutions). */
export async function loadIssueReport(service: Service, branchId: string): Promise<IssueReport> {
  const since = new Date(Date.now() - ISSUE_REPORT_DAYS * 86_400_000).toISOString()
  const [{ data: rows }, { data: marks }] = await Promise.all([
    service
      .from('checklist_assignments')
      .select('id, staff_id, shift_id, checklist_kind, issues, answers, submitted_at, manager_resolved_at')
      .eq('branch_id', branchId)
      .eq('status', 'submitted')
      .gte('submitted_at', since)
      .order('submitted_at', { ascending: false })
      .limit(800),
    service.from('checklist_issue_resolutions').select('item_id, resolved_at').eq('branch_id', branchId).order('resolved_at', { ascending: false }).limit(2000),
  ])
  const shiftIds = [...new Set((rows ?? []).map((row) => row.shift_id as string))]
  const staffIds = [...new Set((rows ?? []).map((row) => row.staff_id as string | null).filter((id): id is string => Boolean(id)))]
  const [{ data: shifts }, { data: people }] = await Promise.all([
    shiftIds.length ? service.from('shifts').select('id, shift_date, start_time, end_time').in('id', shiftIds) : Promise.resolve({ data: [] }),
    staffIds.length ? service.from('staff').select('id, display_name, first_name, last_name, handle').in('id', staffIds) : Promise.resolve({ data: [] }),
  ])
  const shiftOf = new Map((shifts ?? []).map((row) => [row.id as string, row]))
  const nameOf = new Map((people ?? []).map((row) => [row.id as string, personLabel(row)]))

  const sources: IssueSource[] = (rows ?? []).flatMap((row): IssueSource[] => {
    const shift = shiftOf.get(row.shift_id as string)
    if (!shift || !row.submitted_at) return []
    const issues = Array.isArray(row.issues) ? (row.issues as IssueSource['issues']) : []
    const answers = (row.answers ?? {}) as Record<string, { result?: string }>
    const reported = new Set(issues.map((issue) => issue.itemId))
    return [{
      id: row.id as string,
      staffId: (row.staff_id as string | null) ?? null,
      staffName: nameOf.get(row.staff_id as string) ?? 'עמית/ה',
      shiftDate: shift.shift_date as string,
      startTime: shift.start_time as string,
      endTime: shift.end_time as string,
      kind: row.checklist_kind as ChecklistKind,
      submittedAt: row.submitted_at as string,
      issues,
      okItems: Object.entries(answers).filter(([itemId, answer]) => answer?.result === 'ok' && !reported.has(itemId)).map(([itemId]) => itemId),
      handled: Boolean(row.manager_resolved_at),
    }]
  })

  // Newest mark per check wins (the rows come newest first).
  const resolvedAt: Record<string, string> = {}
  for (const mark of marks ?? []) if (!(mark.item_id as string in resolvedAt)) resolvedAt[mark.item_id as string] = mark.resolved_at as string
  return buildIssueReport(sources, resolvedAt)
}
