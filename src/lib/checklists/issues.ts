// The owner's "what is missing or not working" report: every NO answer from the checklists, grouped by the CHECK it
// was about (the ice machine, the oat milk), not by the form it came in. Pure on purpose (no '@/' runtime imports, no
// server-only), like window.ts: the loader feeds it rows, the page renders what it returns, the morning alert counts
// with it, and scripts/check-checklist-issues.mjs runs this very file.
//
// What counts as "still open":
//   * a report is an occurrence: one person, one checklist, one answer "not fine" for that check, with the reason;
//   * the owner marks a check handled -> reports of it submitted up to that moment are done (`resolvedAt`); a report
//     submitted later opens it again, so a machine that breaks twice shows twice;
//   * the older per-checklist "handled" (manager_resolved_at on a submitted checklist) still hides that checklist's reports;
//   * when a LATER checklist answered the same check "fine" the check looks fixed: it moves to `recovered`
//     (shown quietly, not counted, not in the morning alert) until the owner closes it or someone reports it again.

import type { ChecklistKind } from './types'

export type IssueSource = {
  /** the checklist row */
  id: string
  staffId: string | null
  staffName: string
  shiftDate: string
  startTime: string
  endTime: string
  kind: ChecklistKind
  /** ISO timestamp of the submission */
  submittedAt: string
  issues: { itemId: string; label: string; category: string; type: string; reason: string; value?: number; target?: number }[]
  /** ids of the checks this checklist answered "fine" (not in `issues`) */
  okItems: string[]
  /** the older whole-checklist "handled" mark */
  handled: boolean
}

export type IssueReporter = {
  checklistId: string
  staffId: string | null
  staffName: string
  shiftDate: string
  startTime: string
  endTime: string
  kind: ChecklistKind
  submittedAt: string
  reason: string
  value?: number
  target?: number
}

export type IssueGroup = {
  itemId: string
  label: string
  category: string
  type: string
  /** newest first */
  reports: IssueReporter[]
  firstAt: string
  lastAt: string
  /** different people who reported it */
  people: number
  /** different shift dates it was reported on */
  days: number
  /** set when a later checklist answered this check "fine": when */
  recoveredAt: string | null
}

export type IssueReport = { open: IssueGroup[]; recovered: IssueGroup[] }

const when = (iso: string) => Date.parse(iso)

/** `resolvedAt`: item id -> ISO time the owner last marked it handled. */
export function buildIssueReport(rows: IssueSource[], resolvedAt: Record<string, string> = {}): IssueReport {
  const groups = new Map<string, IssueGroup>()
  for (const row of [...rows].sort((a, b) => when(b.submittedAt) - when(a.submittedAt))) {
    if (row.handled) continue
    for (const issue of row.issues) {
      const closedAt = resolvedAt[issue.itemId]
      if (closedAt && when(row.submittedAt) <= when(closedAt)) continue
      const group = groups.get(issue.itemId) ?? {
        // rows are visited newest first, so the first one seen names the check the way it reads today
        itemId: issue.itemId, label: issue.label, category: issue.category, type: issue.type,
        reports: [], firstAt: row.submittedAt, lastAt: row.submittedAt, people: 0, days: 0, recoveredAt: null,
      }
      group.reports.push({
        checklistId: row.id, staffId: row.staffId, staffName: row.staffName, shiftDate: row.shiftDate,
        startTime: row.startTime, endTime: row.endTime, kind: row.kind, submittedAt: row.submittedAt,
        reason: issue.reason, ...(issue.value !== undefined ? { value: issue.value } : {}), ...(issue.target !== undefined ? { target: issue.target } : {}),
      })
      group.firstAt = row.submittedAt
      groups.set(issue.itemId, group)
    }
  }

  const open: IssueGroup[] = []
  const recovered: IssueGroup[] = []
  for (const group of groups.values()) {
    group.people = new Set(group.reports.map((r) => r.staffId ?? r.staffName)).size
    group.days = new Set(group.reports.map((r) => r.shiftDate)).size
    group.lastAt = group.reports[0]!.submittedAt
    // A later checklist that answered the same check "fine" (and a later checklist that reported it again would be in `reports`).
    const fine = rows.filter((row) => when(row.submittedAt) > when(group.lastAt) && row.okItems.includes(group.itemId)).sort((a, b) => when(b.submittedAt) - when(a.submittedAt))[0]
    if (fine) {
      group.recoveredAt = fine.submittedAt
      recovered.push(group)
    } else open.push(group)
  }
  // Worst first: reported most often, then most recently.
  open.sort((a, b) => b.reports.length - a.reports.length || when(b.lastAt) - when(a.lastAt) || a.label.localeCompare(b.label, 'he'))
  recovered.sort((a, b) => when(b.recoveredAt!) - when(a.recoveredAt!))
  return { open, recovered }
}

export const ISSUE_TYPE_LABELS: Record<string, string> = {
  inventory: 'חסר במלאי',
  equipment: 'ציוד / מכונה',
  cleanliness: 'ניקיון',
  cash: 'קופה',
  other: 'אחר',
}

/** "דווח 3 פעמים · 2 עובדים · 3 ימים" — how loud the problem is, in one line. */
export function issueSummary(group: Pick<IssueGroup, 'reports' | 'people' | 'days'>): string {
  const times = group.reports.length === 1 ? 'דווח פעם אחת' : `דווח ${group.reports.length} פעמים`
  const people = group.people === 1 ? '' : ` · ${group.people} עובדים`
  const days = group.days === 1 ? '' : ` · ב־${group.days} ימים`
  return `${times}${people}${days}`
}
