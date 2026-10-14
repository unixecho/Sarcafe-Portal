// When a shift's checklist may be filled in, and what state it is in. Pure on purpose (no '@/' runtime
// imports, no server-only): the API enforces it, the employee screens grey out what is locked, the owner's
// tracker colours its rows with it, and scripts/check-checklist-window.mjs runs this very file.

export type WallClock = { date: string; time: string }

/** A checklist cannot be opened, saved or submitted before its shift starts. Raise this (minutes) only if the
 *  owner ever wants people to be able to start a little early; 0 is "not before the shift", as asked. */
export const CHECKLIST_EARLY_MINUTES = 0

/** The checklists of the END of a shift (closing, and the handover the person who also opened hands over) open this
 *  long before the shift ends, not when it starts: closing the place is done at the end, and a closing form that
 *  opens at 13:00 for a 13:00-19:00 shift is just a form to forget. Opening and the arriving handover still open at the start. */
export const END_UNLOCK_BEFORE_MINUTES = 30

/** How long after it becomes due a checklist counts as late in the owner's tracker. Mirrors the reminders
 *  (src/lib/push/staff-rules.ts, OPENING_GRACE_MINUTES / END_GRACE_MINUTES): opening and the arriving handover
 *  60 min after the shift starts, closing and the departing handover 90 min after it ends. Two files because
 *  each is transpiled on its own by the check scripts; scripts/check-staff-push.mjs fails if they drift apart. */
const LATE_AFTER_START_MINUTES = 60
const LATE_AFTER_END_MINUTES = 90

/** An owner can dismiss a checklist that was never sent ("not needed any more"). It is stored in the columns the
 *  table already has for an owner's handling of a row: `manager_resolved_at` / `_by` / `manager_note` (the note is the
 *  optional reason). A submitted checklist is never "dismissed": there `manager_resolved_at` still means "the reported
 *  issues were handled". No schema change, so nothing has to be applied to the database for this to work. */
export const isDismissed = (row: { status: string; resolvedAt?: string | null }): boolean => row.status !== 'submitted' && Boolean(row.resolvedAt)

export type ChecklistPhase =
  | 'submitted' // done
  | 'covered' // somebody else on the shift sends it (the owner picked them, or they sent it first): not asked of this person
  | 'dismissed' // an owner said it is not needed: no longer asked for, no alerts, cannot be filled in
  | 'upcoming' // the shift has not started: locked
  | 'open' // the shift is on (or just ended) and it can be filled in
  | 'late' // due time passed and still not submitted

const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
const abs = (date: string, minutes: number) => dayNumber(date) * 1440 + minutes

type ShiftTimes = { date: string; startTime: string; endTime: string }

export const shiftStartAbs = (shift: ShiftTimes) => abs(shift.date, minutesOf(shift.startTime))
export const shiftEndAbs = (shift: ShiftTimes) => {
  const start = minutesOf(shift.startTime)
  const end = minutesOf(shift.endTime)
  return shiftStartAbs(shift) + (end > start ? end - start : 24 * 60 - start + end)
}
export const clockAbs = (now: WallClock) => abs(now.date, minutesOf(now.time))

/** Which end of the shift a checklist hangs on: opening, and the handover of the person who arrives to take over (their
 *  shift has no opening), at the START; closing, and the handover of the person who also opened (they hand over as they
 *  leave), at the END. The same rule as dueAnchor in staff-rules.ts (check:staff-push compares them). With no kind given
 *  (older callers that only know the shift) the checklist hangs on the start, as before. */
export function checklistAnchor(kind: string | undefined, shiftHasOpening: boolean | undefined): 'start' | 'end' {
  if (kind === undefined || kind === 'opening') return 'start'
  if (kind === 'handover') return shiftHasOpening ? 'end' : 'start'
  return 'end'
}

/** What decides when a checklist opens: the shift, plus which kind it is (and whether the shift has an opening). */
export type LockInput = ShiftTimes & { kind?: string; shiftHasOpening?: boolean }

/** The absolute minute a checklist opens: the shift's start for a start-of-shift checklist, END_UNLOCK_BEFORE_MINUTES
 *  before the end for an end-of-shift one (never earlier than the start, so a very short shift still works). */
export function unlockAbs(input: LockInput): number {
  const atStart = shiftStartAbs(input) - CHECKLIST_EARLY_MINUTES
  if (checklistAnchor(input.kind, input.shiftHasOpening) === 'start') return atStart
  return Math.max(atStart, shiftEndAbs(input) - END_UNLOCK_BEFORE_MINUTES)
}

/** Minutes until the checklist unlocks (0 or negative once it has). */
export function minutesUntilUnlock(input: LockInput, now: WallClock): number {
  return unlockAbs(input) - clockAbs(now)
}

/** True until the checklist's own moment, so it must stay shut. */
export function isChecklistLocked(input: LockInput, now: WallClock): boolean {
  return minutesUntilUnlock(input, now) > 0
}

/** The sentence for WHY it is shut, which differs by kind (the shift has not started / it opens near the end). */
export function lockedBecause(input: LockInput): string {
  return checklistAnchor(input.kind, input.shiftHasOpening) === 'start' ? 'המשמרת עוד לא התחילה' : 'הצ׳קליסט נפתח חצי שעה לפני סוף המשמרת'
}

/** The wall-clock moment a checklist unlocks, e.g. { date: '2026-10-13', time: '07:30' }. */
export function unlockMoment(input: LockInput): WallClock {
  const total = unlockAbs(input)
  const day = Math.floor(total / 1440)
  const minutes = total - day * 1440
  const date = new Date(day * 86_400_000).toISOString().slice(0, 10)
  return { date, time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
}

/** `shiftHasOpening` decides which end a handover hangs on (see dueAnchor in staff-rules): the person who also
 *  opens hands over at the END of their shift, the person who arrives to take over does it after they START. */
export function checklistPhase(
  input: ShiftTimes & { kind: string; status: string; shiftHasOpening?: boolean; dismissed?: boolean },
  now: WallClock
): ChecklistPhase {
  if (input.status === 'submitted') return 'submitted'
  if (input.status === 'covered') return 'covered'
  if (input.dismissed) return 'dismissed'
  if (isChecklistLocked(input, now)) return 'upcoming'
  const anchorStart = checklistAnchor(input.kind, input.shiftHasOpening) === 'start'
  const due = anchorStart ? shiftStartAbs(input) + LATE_AFTER_START_MINUTES : shiftEndAbs(input) + LATE_AFTER_END_MINUTES
  // `>=`: the alert goes out AT the due minute (minutesPastDue >= 0), so the tracker says late from that same minute.
  return clockAbs(now) >= due ? 'late' : 'open'
}

/** The wall clock a few seconds or minutes later, so a page that loaded `base` from the server can keep
 *  time without trusting the phone's own (possibly wrong) clock or timezone. */
export function advanceClock(base: WallClock, elapsedMs: number): WallClock {
  const ms = Date.parse(`${base.date}T${base.time}:00Z`) + Math.max(0, Math.floor(elapsedMs / 60_000)) * 60_000
  const iso = new Date(ms).toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) }
}

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
/** "יום ג׳ 13.10" — the label of a date in the day spacer. */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  return `יום ${HE_DAYS[d.getUTCDay()]} · ${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
/** "מחר ב־07:30" / "ביום שלישי 13.10 ב־07:30" — when a locked checklist opens, in words. */
export function unlockText(input: LockInput, now: WallClock): string {
  const at = unlockMoment(input)
  const days = dayNumber(at.date) - dayNumber(now.date)
  if (days === 0) return `ייפתח היום ב־${at.time}`
  if (days === 1) return `ייפתח מחר ב־${at.time}`
  return `ייפתח ${dayLabel(at.date).replace(' · ', ' ')} ב־${at.time}`
}
