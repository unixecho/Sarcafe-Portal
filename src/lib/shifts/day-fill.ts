// "Fill one day, one shift at a time" — the model behind the guided day sheet (DayFillSheet.tsx).
// Pure: no React, no database. The sheet keeps a DRAFT of the day built from this file; nothing is
// written until the owner presses אישור, and then each changed shift is saved with the one
// `saveShift` action the regular shift sheet already uses (atomic per shift, checked by the database).
//
// The model, stated once:
//   * a day is a list of SHIFTS (the ones already on the board for that date, earliest first;
//     a day with none starts from the shift templates in Settings, exactly what "הכנת שבוע" would add);
//   * each shift has SEATS: as many people as it asks for (its per-role minimums), at least one,
//     and never fewer than the people already on it;
//   * a STEP is one empty seat. The sheet always shows the first empty seat that was not skipped,
//     asks "who works here?", and one tap on a name fills that seat and moves on. One tap = one person,
//     so two people can never land on one seat by accident;
//   * a person can be on a shift only once, and never on two shifts of the day whose hours overlap.

import { defaultTimesFor } from './presets'
import { intervalOf, weekStartOf } from './time'
import type { Assignment, HM, ISODate, RoleRequirement, Shift, ShiftPreset, ShiftSettings } from './types'
import { neededFor } from './coverage'

export type FillPerson = { staffId: string; roleId: string | null; assignmentId?: string }

export type FillShift = {
  /** shift id, or `tpl:<n>` for a template shift not created yet, or `custom:<n>` for one the owner added here. */
  key: string
  shiftId: string | null
  date: ISODate
  startTime: HM
  endTime: HM
  presetId: string | null
  stationId: string | null
  requirements: RoleRequirement[]
  requestsOpen: boolean
  note: string | null
  updatedAt: string | null
  /** The template's name, else the shift's note, else '' (the sheet then says "משמרת"). */
  name: string
  seats: number
  people: FillPerson[]
  /** People on it when the sheet opened (to know what changed). */
  original: FillPerson[]
  /** Already began: shown, never offered for picking. */
  locked: boolean
}

export type FillStep = { key: string; seat: number }

type SeedInput = {
  date: ISODate
  settings: Pick<ShiftSettings, 'presets' | 'openTime' | 'closeTime' | 'dayHours'>
  shifts: Shift[]
  assignments: Assignment[]
  /** hasStarted(shift, now), passed in so this file stays clock-free. */
  started: (s: { date: ISODate; startTime: HM }) => boolean
}

const byTime = (a: { startTime: HM; endTime: HM }, b: { startTime: HM; endTime: HM }) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime)

/** How many people a shift wants: its minimums, at least one, never fewer than are on it. */
export function seatsFor(requirements: RoleRequirement[], peopleCount: number): number {
  return Math.max(1, neededFor(requirements), peopleCount)
}

function templateRequirements(p: Pick<ShiftPreset, 'roleId'>): RoleRequirement[] {
  // The same rule as sched_prepare_week: a template that names a role asks for one of it.
  return p.roleId ? [{ roleId: p.roleId, min: 1 }] : []
}

/** The day as the sheet opens it. */
export function seedDay({ date, settings, shifts, assignments, started }: SeedInput): FillShift[] {
  const onDay = shifts.filter((s) => s.date === date).sort(byTime)
  if (onDay.length > 0) {
    return onDay.map((s) => {
      const people = assignments
        .filter((a) => a.shiftId === s.id && a.staffId)
        .map((a) => ({ staffId: a.staffId!, roleId: a.roleId, assignmentId: a.id }))
      const preset = s.presetId ? settings.presets.find((p) => p.id === s.presetId) : undefined
      return {
        key: s.id,
        shiftId: s.id,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        presetId: s.presetId,
        stationId: s.stationId,
        requirements: s.requirements,
        requestsOpen: s.requestsOpen,
        note: s.note,
        updatedAt: s.updatedAt,
        name: preset?.name ?? s.note ?? '',
        seats: seatsFor(s.requirements, people.length),
        people,
        original: people,
        locked: started(s),
      }
    })
  }
  const templates: Array<Pick<ShiftPreset, 'startTime' | 'endTime' | 'roleId' | 'stationId' | 'name'> & { id: string | null }> =
    settings.presets.length > 0
      ? [...settings.presets].sort(byTime)
      : (() => {
          const d = defaultTimesFor(date, settings)
          return [{ id: null, name: '', startTime: d.startTime, endTime: d.endTime }]
        })()
  return templates
    .filter((t) => !started({ date, startTime: t.startTime }))
    .map((t, i) => {
      const requirements = templateRequirements(t)
      return {
        key: `tpl:${i}`,
        shiftId: null,
        date,
        startTime: t.startTime,
        endTime: t.endTime,
        presetId: t.id,
        stationId: t.stationId ?? null,
        requirements,
        requestsOpen: false,
        note: null,
        updatedAt: null,
        name: t.name,
        seats: seatsFor(requirements, 0),
        people: [],
        original: [],
        locked: false,
      }
    })
}

/** Every empty seat, in order (earliest shift first, seat 1 before seat 2). */
export function emptySteps(day: FillShift[]): FillStep[] {
  const out: FillStep[] = []
  for (const s of day) {
    if (s.locked) continue
    for (let seat = s.people.length; seat < s.seats; seat++) out.push({ key: s.key, seat })
  }
  return out
}

/** The seat the sheet should ask about next, or null when the day is done (every seat filled or skipped). */
export function nextStep(day: FillShift[], skipped: ReadonlySet<string>): FillStep | null {
  return emptySteps(day).find((st) => !skipped.has(stepId(st))) ?? null
}

export const stepId = (st: FillStep) => `${st.key}#${st.seat}`

/** Put `staffId` on `seat` of shift `key` (replacing whoever sat there). A seat past the people list fills the next free one. */
export function placePerson(day: FillShift[], key: string, seat: number, person: FillPerson): FillShift[] {
  return day.map((s) => {
    if (s.key !== key) return s
    // Backstop: the picker never offers someone already on another seat of this shift.
    if (s.people.some((p, i) => p.staffId === person.staffId && i !== seat)) return s
    const next = [...s.people]
    const idx = Math.min(seat, next.length)
    const prev = next[idx]
    // Tapping the person who already sits there keeps their saved assignment (nothing changes).
    next[idx] = prev && prev.staffId === person.staffId ? prev : person
    return { ...s, people: next, seats: Math.max(s.seats, next.length) }
  })
}

/** Empty a seat (the people after it move up one). */
export function clearSeat(day: FillShift[], key: string, seat: number): FillShift[] {
  return day.map((s) => (s.key === key ? { ...s, people: s.people.filter((_, i) => i !== seat) } : s))
}

/** One more seat on a shift ("עוד עובד/ת למשמרת הזו"). */
export function addSeat(day: FillShift[], key: string): FillShift[] {
  return day.map((s) => (s.key === key ? { ...s, seats: Math.max(s.seats, s.people.length) + 1 } : s))
}

/** A shift with its own hours and a label (the note employees see in the schedule), added from the sheet. */
export function addCustomShift(day: FillShift[], date: ISODate, startTime: HM, endTime: HM, label: string, n: number): { day: FillShift[]; key: string } {
  const key = `custom:${n}`
  const note = label.trim() || null
  const shift: FillShift = {
    key,
    shiftId: null,
    date,
    startTime,
    endTime,
    presetId: null,
    stationId: null,
    requirements: [],
    requestsOpen: false,
    note,
    updatedAt: null,
    name: note ?? '',
    seats: 1,
    people: [],
    original: [],
    locked: false,
  }
  return { day: [...day, shift].sort((a, b) => byTime(a, b) || (a.key < b.key ? -1 : 1)), key }
}

export type PickBlock =
  | { kind: 'same_shift' }
  | { kind: 'overlap_today'; with: FillShift }
  | null

/**
 * Can `staffId` take a seat on shift `key` of the draft day? Only the draft is checked here (same shift,
 * an overlapping shift of the same day as the sheet has it); the rest of the week, approved days off and
 * the other branch are checked by the caller / the database.
 */
export function draftBlock(day: FillShift[], key: string, seat: number, staffId: string): PickBlock {
  const target = day.find((s) => s.key === key)
  if (!target) return null
  if (target.people.some((p, i) => p.staffId === staffId && i !== seat)) return { kind: 'same_shift' }
  const ws = weekStartOf(target.date)
  const t = intervalOf(ws, target)
  for (const s of day) {
    if (s.key === key || !s.people.some((p) => p.staffId === staffId)) continue
    const i = intervalOf(ws, s)
    if (i.start < t.end && t.start < i.end) return { kind: 'overlap_today', with: s }
  }
  return null
}

/** Other shifts of the draft day this person works that do NOT overlap (a double shift: allowed, but said). */
export function alsoToday(day: FillShift[], key: string, staffId: string): FillShift[] {
  return day.filter((s) => s.key !== key && s.people.some((p) => p.staffId === staffId))
}

const sig = (people: FillPerson[]) => people.map((p) => `${p.staffId}:${p.roleId ?? ''}:${p.assignmentId ?? ''}`).join(',')

/** The shifts the owner changed (and so must be saved). A template shift nobody was put on is not created. */
export function changedShifts(day: FillShift[]): FillShift[] {
  return day.filter((s) => !s.locked && (s.shiftId ? sig(s.people) !== sig(s.original) : s.people.length > 0))
}

/** The saved shifts the draft day stands for: the database's copy of them is left out of clash checks (the draft is the truth). */
export function draftShiftIds(day: FillShift[]): Set<string> {
  return new Set(day.map((s) => s.shiftId).filter((id): id is string => !!id))
}
