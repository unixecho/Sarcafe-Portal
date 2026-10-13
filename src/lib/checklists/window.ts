// When a shift's checklist may be filled in, and what state it is in. Pure on purpose (no '@/' runtime
// imports, no server-only): the API enforces it, the employee screens grey out what is locked, the owner's
// tracker colours its rows with it, and scripts/check-checklist-window.mjs runs this very file.

export type WallClock = { date: string; time: string }

/** A checklist cannot be opened, saved or submitted before its shift starts. Raise this (minutes) only if the
 *  owner ever wants people to be able to start a little early; 0 is "not before the shift", as asked. */
export const CHECKLIST_EARLY_MINUTES = 0

/** How long after it becomes due a checklist counts as late in the owner's tracker. Mirrors the reminders
 *  (src/lib/push/staff-rules.ts): opening and the arriving handover 60 min after the shift starts, closing
 *  and the departing handover 10 min after it ends. */
const LATE_AFTER_START_MINUTES = 60
const LATE_AFTER_END_MINUTES = 10

export type ChecklistPhase =
  | 'submitted' // done
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

/** Minutes until the checklist unlocks (0 or negative once it has). */
export function minutesUntilUnlock(shift: ShiftTimes, now: WallClock): number {
  return shiftStartAbs(shift) - CHECKLIST_EARLY_MINUTES - clockAbs(now)
}

/** True while the shift has not started yet, so the checklist must stay shut. */
export function isChecklistLocked(shift: ShiftTimes, now: WallClock): boolean {
  return minutesUntilUnlock(shift, now) > 0
}

/** The wall-clock moment a checklist unlocks, e.g. { date: '2026-10-13', time: '07:30' }. */
export function unlockMoment(shift: ShiftTimes): WallClock {
  const total = shiftStartAbs(shift) - CHECKLIST_EARLY_MINUTES
  const day = Math.floor(total / 1440)
  const minutes = total - day * 1440
  const date = new Date(day * 86_400_000).toISOString().slice(0, 10)
  return { date, time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
}

/** `shiftHasOpening` decides which end a handover hangs on (see dueAnchor in staff-rules): the person who also
 *  opens hands over at the END of their shift, the person who arrives to take over does it after they START. */
export function checklistPhase(
  input: ShiftTimes & { kind: string; status: string; shiftHasOpening?: boolean },
  now: WallClock
): ChecklistPhase {
  if (input.status === 'submitted') return 'submitted'
  if (isChecklistLocked(input, now)) return 'upcoming'
  const anchorStart = input.kind === 'opening' || (input.kind === 'handover' && !input.shiftHasOpening)
  const due = anchorStart ? shiftStartAbs(input) + LATE_AFTER_START_MINUTES : shiftEndAbs(input) + LATE_AFTER_END_MINUTES
  return clockAbs(now) > due ? 'late' : 'open'
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
export function unlockText(shift: ShiftTimes, now: WallClock): string {
  const at = unlockMoment(shift)
  const days = dayNumber(at.date) - dayNumber(now.date)
  if (days === 0) return `ייפתח היום ב־${at.time}`
  if (days === 1) return `ייפתח מחר ב־${at.time}`
  return `ייפתח ${dayLabel(at.date).replace(' · ', ' ')} ב־${at.time}`
}
