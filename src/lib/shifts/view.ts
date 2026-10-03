// Read-side helpers over a loaded ShiftsDB — pure (no React, no fetching), so the
// manager's board, the employee's schedule, the requests inbox and the print
// sheet all answer the same questions the same way: who is this person, which
// requests are waiting on whom, which shifts clash.

import { coverageOf, isFull, type Coverage } from './coverage'
import { formatShiftLabel, intervalOf } from './time'
import type { Assignment, ScheduleStaffRow, Shift, ShiftRequest, ShiftsDB, SwapRequest, SwapSide } from './types'

/** A real name for a person id. Live roster first (a renamed person is renamed
 *  everywhere), then the name snapshotted on the record, then a last resort. */
export function nameOf(db: Pick<ShiftsDB, 'roster'>, staffId: string | null | undefined, snapshot?: string | null): string {
  if (staffId) {
    const row = db.roster.find((r) => r.staffId === staffId)
    if (row) return row.displayName
  }
  return snapshot?.trim() || 'עובד/ת שהוסר/ה'
}

export function rosterRow(db: Pick<ShiftsDB, 'roster'>, staffId: string | null | undefined): ScheduleStaffRow | undefined {
  return staffId ? db.roster.find((r) => r.staffId === staffId) : undefined
}

export function indexByShift(assignments: Assignment[]): Map<string, Assignment[]> {
  const map = new Map<string, Assignment[]>()
  for (const a of assignments) {
    const list = map.get(a.shiftId) ?? []
    list.push(a)
    map.set(a.shiftId, list)
  }
  return map
}

export const isActiveSwap = (s: Pick<SwapRequest, 'status'>) => s.status === 'open' || s.status === 'peer_accepted'

/** Assignment ids that are part of a live swap (either side) — "swap pending" is derived
 *  from the swaps list; the assignment itself is never altered by a pending swap. */
export function swapPendingAssignmentIds(swaps: SwapRequest[]): Set<string> {
  const ids = new Set<string>()
  for (const s of swaps) {
    if (!isActiveSwap(s)) continue
    if (s.assignmentId) ids.add(s.assignmentId)
    if (s.returnAssignmentId) ids.add(s.returnAssignmentId)
  }
  return ids
}

export function pendingRequestsByShift(requests: ShiftRequest[]): Map<string, ShiftRequest[]> {
  const map = new Map<string, ShiftRequest[]>()
  for (const r of requests) {
    if (r.status !== 'pending' || !r.shiftId) continue
    const list = map.get(r.shiftId) ?? []
    list.push(r)
    map.set(r.shiftId, list)
  }
  return map
}

/** What is waiting on a MANAGER right now (drives the badge and the banner). */
export function managerInbox(db: Pick<ShiftsDB, 'requests' | 'swaps'>) {
  const requests = db.requests.filter((r) => r.status === 'pending')
  const swaps = db.swaps.filter((s) => s.status === 'peer_accepted')
  return { requests, swaps, count: requests.length + swaps.length }
}

/** What is waiting on THIS EMPLOYEE: swap proposals addressed to them. */
export function employeeInbox(db: Pick<ShiftsDB, 'swaps' | 'viewerStaffId'>) {
  const proposals = db.swaps.filter((s) => s.status === 'open' && s.toStaffId === db.viewerStaffId && s.fromStaffId !== db.viewerStaffId)
  return { proposals, count: proposals.length }
}

// ---- Clash detection (advisory — the database is the authority) ---------------------

/** Shifts (in the loaded window, this branch) this person already works that overlap `shift`'s time. */
export function clashesFor(
  staffId: string,
  target: Pick<Shift, 'date' | 'startTime' | 'endTime'>,
  weekStart: string,
  shifts: Shift[],
  assignments: Assignment[],
  ignoreShiftId?: string | null
): Shift[] {
  const t = intervalOf(weekStart, target)
  const byShift = new Map(shifts.map((s) => [s.id, s]))
  const out: Shift[] = []
  for (const a of assignments) {
    if (a.staffId !== staffId || a.shiftId === ignoreShiftId) continue
    const s = byShift.get(a.shiftId)
    if (!s) continue
    const i = intervalOf(weekStart, s)
    if (i.start < t.end && t.start < i.end) out.push(s)
  }
  return out
}

/** Coverage plus the pieces the board needs for one shift. */
export function shiftFacts(shift: Shift, assignments: Assignment[]): { coverage: Coverage; full: boolean } {
  const coverage = coverageOf(shift, assignments)
  return { coverage, full: isFull(coverage) }
}

// ---- Labels for what a request / swap was ABOUT ---------------------------------------------
// Built from the structured date + times the record kept (never the stored text), so every screen
// writes a shift the same way — bidi-isolated, in clock order — whatever produced the record.

export function sideLabel(side?: SwapSide | null): string {
  return side ? formatShiftLabel(side.date, side.start, side.end) : 'משמרת'
}

export function requestLabel(terms: ShiftRequest['terms']): string {
  return terms.date && terms.start && terms.end ? formatShiftLabel(terms.date, terms.start, terms.end) : (terms.label ?? 'משמרת')
}
