// Read-side helpers over a loaded ShiftsDB — pure (no React, no fetching), so the
// manager's board, the employee's schedule, the requests inbox and the print
// sheet all answer the same questions the same way: who is this person, which
// requests are waiting on whom, which shifts clash.

import { coverageOf, isFull, type Coverage } from './coverage'
import { formatShiftLabel, hasStarted, intervalOf, weekStartOf } from './time'
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

type SwapParties = Pick<SwapRequest, 'direction' | 'fromStaffId' | 'toStaffId'>

/** Who started a swap. A hand-over or exchange is started by the person giving the shift;
 *  a take by the person who wants it. */
export const swapInitiatorId = (s: SwapParties): string | null => (s.direction === 'take' ? s.toStaffId : s.fromStaffId)

/** Who has to answer it first: the named taker of a give (null = an open offer anyone may
 *  take), or the person holding the shift for a take. */
export const swapResponderId = (s: SwapParties): string | null => (s.direction === 'take' ? s.fromStaffId : s.toStaffId)

/** The names recorded on the swap for each side, for when the live roster no longer has the person. */
export const swapInitiatorName = (s: SwapParties & Pick<SwapRequest, 'fromStaffName' | 'toStaffName'>) => (s.direction === 'take' ? s.toStaffName : s.fromStaffName)
export const swapResponderName = (s: SwapParties & Pick<SwapRequest, 'fromStaffName' | 'toStaffName'>) => (s.direction === 'take' ? s.fromStaffName : s.toStaffName)

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

/** What is waiting on THIS EMPLOYEE: swap proposals addressed to them, and colleagues asking for their shift. */
export function employeeInbox(db: Pick<ShiftsDB, 'swaps' | 'viewerStaffId'>) {
  const proposals = db.swaps.filter((s) => s.status === 'open' && !!db.viewerStaffId && swapResponderId(s) === db.viewerStaffId && swapInitiatorId(s) !== db.viewerStaffId)
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

/** One of MY upcoming shifts I could give a colleague in exchange for the shift `target` they
 *  hold. `blocked` says why it cannot be offered: taking `target` would overlap another shift of
 *  mine (the one offered is excluded, it goes away), or the colleague already works when the
 *  one offered happens (`target` is excluded, it goes away). */
export type ExchangeOffer = { assignment: Assignment; shift: Shift; blocked: 'mine_overlaps' | 'theirs_overlaps' | null }

export function exchangeOffers(db: Pick<ShiftsDB, 'viewerStaffId' | 'shifts' | 'assignments' | 'swaps' | 'now'>, target: Shift, holderId: string): ExchangeOffer[] {
  const me = db.viewerStaffId
  if (!me) return []
  const pending = swapPendingAssignmentIds(db.swaps)
  const shiftById = new Map(db.shifts.map((s) => [s.id, s]))
  const offers: ExchangeOffer[] = []
  for (const assignment of db.assignments) {
    if (assignment.staffId !== me || pending.has(assignment.id)) continue
    const shift = shiftById.get(assignment.shiftId)
    if (!shift || shift.id === target.id || shift.branchId !== target.branchId || hasStarted(shift, db.now)) continue
    const mineOverlaps = clashesFor(me, target, weekStartOf(target.date), db.shifts, db.assignments, shift.id).length > 0
    const theirsOverlaps = !mineOverlaps && clashesFor(holderId, shift, weekStartOf(shift.date), db.shifts, db.assignments, target.id).length > 0
    offers.push({ assignment, shift, blocked: mineOverlaps ? 'mine_overlaps' : theirsOverlaps ? 'theirs_overlaps' : null })
  }
  return offers.sort((a, b) => a.shift.date.localeCompare(b.shift.date) || a.shift.startTime.localeCompare(b.shift.startTime))
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
