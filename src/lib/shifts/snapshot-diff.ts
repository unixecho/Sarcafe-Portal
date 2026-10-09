// "Has the manager changed this week since employees last saw it?"
//
// Employees read a FROZEN copy (schedule_weeks.published_snapshot); the manager
// edits the live rows. Until now nothing told the manager that the two had
// drifted apart — so an edit to a published week looked saved but was invisible
// to the team. This compares live to snapshot and says so in plain counts.

import type { Assignment, ScheduleWeek, Shift } from './types'

export type UnpublishedChanges = {
  /** Shifts added, removed, or whose date/time/needs changed. */
  shifts: number
  /** People added to / removed from shifts, or whose role changed. */
  people: number
  total: number
}

const key = (a: Pick<Assignment, 'shiftId' | 'staffId' | 'roleId'>) => `${a.shiftId}|${a.staffId ?? ''}|${a.roleId ?? ''}`

function shiftSignature(s: Shift): string {
  return [s.date, s.startTime, s.endTime, s.stationId ?? '', s.requestsOpen ? 'open' : 'closed', s.note ?? '', JSON.stringify(s.requirements ?? [])].join('|')
}

export function unpublishedChanges(week: ScheduleWeek | undefined, shifts: Shift[], assignments: Assignment[]): UnpublishedChanges {
  const none = { shifts: 0, people: 0, total: 0 }
  if (!week || week.status !== 'published' || !week.publishedSnapshot) return none

  const snapShifts = new Map(week.publishedSnapshot.shifts.map((s) => [s.id, s]))
  const liveShifts = new Map(shifts.filter((s) => s.weekId === week.id).map((s) => [s.id, s]))

  let shiftChanges = 0
  for (const [id, live] of liveShifts) {
    const snap = snapShifts.get(id)
    if (!snap || shiftSignature(snap) !== shiftSignature(live)) shiftChanges++
  }
  for (const id of snapShifts.keys()) if (!liveShifts.has(id)) shiftChanges++

  const liveKeys = new Set(assignments.filter((a) => liveShifts.has(a.shiftId)).map(key))
  const snapKeys = new Set(week.publishedSnapshot.assignments.map(key))
  let peopleChanges = 0
  for (const k of liveKeys) if (!snapKeys.has(k)) peopleChanges++
  for (const k of snapKeys) if (!liveKeys.has(k)) peopleChanges++

  return { shifts: shiftChanges, people: peopleChanges, total: shiftChanges + peopleChanges }
}
