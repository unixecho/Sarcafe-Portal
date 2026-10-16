// The "gaps" half of חוסרים ופערים: checklists nobody sent. The other half is issues.ts (what a sent checklist said was
// missing or not working). Pure on purpose (no '@/' runtime imports, no server-only), like issues.ts and window.ts:
// the loader feeds it rows, the page renders what it returns, the morning alert counts with it, and
// scripts/check-checklist-issues.mjs runs this very file.
//
// A gap is ONE checklist of ONE shift that is late (window.ts says when: the same minute the employee's alert goes out)
// and was not sent, not covered by a colleague and not dismissed by an owner. However many people could still send it,
// it is one line, with the people named together. The owner can close it ("not needed") the same way the tracker does.

import { checklistPhase, type WallClock } from './window'
import type { ChecklistKind } from './types'

export type GapSource = {
  /** the checklist row */
  id: string
  shiftId: string
  kind: ChecklistKind
  status: string
  /** `manager_resolved_at`: on an unsent row that means an owner dismissed it */
  resolvedAt: string | null
  staffName: string
  shiftDate: string
  startTime: string
  endTime: string
}

export type GapGroup = {
  /** `${shiftId}|${kind}` */
  key: string
  shiftId: string
  kind: ChecklistKind
  shiftDate: string
  startTime: string
  endTime: string
  /** everyone who could still send it, sorted by name */
  staffNames: string[]
  /** every unsent copy: closing the gap closes all of them */
  ids: string[]
  /** somebody opened it and did not finish */
  started: boolean
}

/** The late, unsent, undismissed checklists of the branch, newest shift first. */
export function buildGaps(rows: GapSource[], now: WallClock): GapGroup[] {
  const hasOpening = new Set(rows.filter((r) => r.kind === 'opening').map((r) => r.shiftId))
  const groups = new Map<string, GapGroup>()
  const closedKeys = new Set<string>()
  for (const row of rows) {
    // Once a copy was sent or a colleague covers it, the checklist is done, whoever else still holds an unsent copy.
    if (row.status === 'submitted' || row.status === 'covered') closedKeys.add(`${row.shiftId}|${row.kind}`)
  }
  for (const row of rows) {
    const key = `${row.shiftId}|${row.kind}`
    if (closedKeys.has(key)) continue
    const phase = checklistPhase(
      { date: row.shiftDate, startTime: row.startTime, endTime: row.endTime, kind: row.kind, status: row.status, shiftHasOpening: hasOpening.has(row.shiftId), dismissed: Boolean(row.resolvedAt) },
      now
    )
    if (phase !== 'late') continue
    const group = groups.get(key) ?? { key, shiftId: row.shiftId, kind: row.kind, shiftDate: row.shiftDate, startTime: row.startTime, endTime: row.endTime, staffNames: [], ids: [], started: false }
    if (!group.staffNames.includes(row.staffName)) group.staffNames.push(row.staffName)
    group.ids.push(row.id)
    if (row.status === 'in_progress') group.started = true
    groups.set(key, group)
  }
  const kindOrder = { opening: 0, handover: 1, closing: 2 } as const
  return [...groups.values()]
    .map((g) => ({ ...g, staffNames: [...g.staffNames].sort((a, b) => a.localeCompare(b, 'he')), ids: [...g.ids].sort() }))
    .sort((a, b) => b.shiftDate.localeCompare(a.shiftDate) || b.startTime.localeCompare(a.startTime) || kindOrder[a.kind] - kindOrder[b.kind])
}

/** How many open things the report holds in total: the number on the dashboard and in the morning alert. */
export const shortageCount = (report: { open: readonly unknown[]; gaps: readonly unknown[] }): number => report.open.length + report.gaps.length

/** "דוח בוקר" title for a count: 1 -> "דבר אחד לטיפול", 3 -> "3 דברים לטיפול". */
export const shortageTitle = (count: number): string => (count === 1 ? 'חוסרים ופערים: דבר אחד לטיפול' : `חוסרים ופערים: ${count} דברים לטיפול`)
