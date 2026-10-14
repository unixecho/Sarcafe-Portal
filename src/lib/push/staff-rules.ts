// The pure rules behind staff push: when a reminder falls due and where tapping an alert goes.
// No server-only imports and no '@/' imports on purpose, so scripts/check-staff-push.mjs runs the real code.

import type { WallClock } from '@/lib/shifts/types'

// ---- Shift reminders (the person's own shifts) ----------------------------------------------
/** "You work tomorrow" goes out the evening before, at this local hour. */
export const SHIFT_EVE_HOUR = 19
/** "You work today" goes out on the morning of the shift, at this local hour. */
export const SHIFT_TODAY_HOUR = 7
/** A reminder that missed its hour (the scheduler was down) is still sent this long after it, then dropped. */
export const SHIFT_REMINDER_WINDOW_MINUTES = 4 * 60

// ---- Checklists -------------------------------------------------------------------------------
/** Heads-up that the shift (and its checklist) starts: this many minutes before it. */
export const PRE_SHIFT_MINUTES = 15
/** Opening checklists, and the handover an arriving employee does, are due this long after the shift starts. */
export const OPENING_GRACE_MINUTES = 60
/** Closing, and the handover a departing employee does, are due this long after the shift ends: closing
 *  the place takes real time, so the owner asked for an hour and a half before anyone is chased.
 *  src/lib/checklists/window.ts (the owner tracker's "late") keeps the same number; check:staff-push fails if they differ. */
export const END_GRACE_MINUTES = 90
/** Owners and developers hear about a missing checklist this long after it became due, i.e. 30 minutes after the
 *  employee was told and the grace had run out: the employee gets the first chance to fix it, the owner is the second line. */
export const OWNER_ESCALATION_MINUTES = 30
/** After this long it is history, not a reminder. */
export const REMINDER_WINDOW_MINUTES = 6 * 60

// ---- "Requests for the week" ------------------------------------------------------------------
/** Sunday and Monday reminders go out at this local hour. */
export const REQUESTS_REMINDER_HOUR = 10
export const REQUESTS_REMINDER_WINDOW_MINUTES = 8 * 60

const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
const absMinutes = (date: string, minutes: number) => dayNumber(date) * 1440 + minutes
const isoOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10)

export const addIsoDays = (date: string, days: number) => isoOf(dayNumber(date) + days)
/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()
/** The Sunday on or before `date`. */
export const sundayOnOrBefore = (date: string) => addIsoDays(date, -weekdayOf(date))

const nowAbs = (now: WallClock) => absMinutes(now.date, minutesOf(now.time))
const startAbs = (shift: { date: string; startTime: string }) => absMinutes(shift.date, minutesOf(shift.startTime))
const endAbs = (shift: { date: string; startTime: string; endTime: string }) => {
  const start = minutesOf(shift.startTime)
  const end = minutesOf(shift.endTime)
  return startAbs(shift) + (end > start ? end - start : 24 * 60 - start + end)
}

/** Minutes until the shift starts (negative once it has). */
export function minutesToStart(shift: { date: string; startTime: string }, now: WallClock): number {
  return startAbs(shift) - nowAbs(now)
}

/** Heads-up window: the shift starts within PRE_SHIFT_MINUTES and has not started. */
export function isPreShift(shift: { date: string; startTime: string }, now: WallClock): boolean {
  const m = minutesToStart(shift, now)
  return m > 0 && m <= PRE_SHIFT_MINUTES
}

/** Which of the two shift reminders (if any) is due for this shift right now.
 *  eve: from 19:00 the day before; today: from 07:00 on the day, until the shift is over. */
export function shiftReminderPhase(shift: { date: string; startTime: string; endTime: string }, now: WallClock): 'eve' | 'today' | null {
  const minuteOfDay = minutesOf(now.time)
  if (shift.date === addIsoDays(now.date, 1)) {
    const since = minuteOfDay - SHIFT_EVE_HOUR * 60
    return since >= 0 && since < SHIFT_REMINDER_WINDOW_MINUTES ? 'eve' : null
  }
  if (shift.date === now.date) {
    const since = minuteOfDay - SHIFT_TODAY_HOUR * 60
    return since >= 0 && since < SHIFT_REMINDER_WINDOW_MINUTES && endAbs(shift) > nowAbs(now) ? 'today' : null
  }
  return null
}

/** What a checklist's due time hangs on. Opening is done at the start of the day. A handover is two-sided:
 *  the employee who also opens hands over at the END of their shift, the one who arrives to take over
 *  (no opening on that shift) does it soon after they START. Closing is the end of the shift. */
export function dueAnchor(kind: string, shiftHasOpening: boolean): 'start' | 'end' {
  if (kind === 'opening') return 'start'
  if (kind === 'handover') return shiftHasOpening ? 'end' : 'start'
  return 'end'
}

/** Minutes since the checklist became due (negative = not due yet). A shift that runs past midnight ends
 *  the next day. */
export function minutesPastDue(
  assignment: { kind: string; date: string; startTime: string; endTime: string; shiftHasOpening?: boolean },
  now: WallClock
): number {
  const anchor = dueAnchor(assignment.kind, assignment.shiftHasOpening ?? assignment.kind === 'opening')
  const due = anchor === 'start' ? startAbs(assignment) + OPENING_GRACE_MINUTES : endAbs(assignment) + END_GRACE_MINUTES
  return nowAbs(now) - due
}

/** The weekly "requests for the week" reminders. Sunday: they are open. Monday: they close tomorrow, Tuesday.
 *  `targetWeek` is the Sunday the requests are FOR (the week after the current one). */
export function requestsReminder(now: WallClock): { phase: 'open' | 'closing'; targetWeek: string; closeDate: string } | null {
  const weekday = weekdayOf(now.date)
  if (weekday !== 0 && weekday !== 1) return null
  const since = minutesOf(now.time) - REQUESTS_REMINDER_HOUR * 60
  if (since < 0 || since >= REQUESTS_REMINDER_WINDOW_MINUTES) return null
  const targetWeek = addIsoDays(sundayOnOrBefore(now.date), 7)
  return { phase: weekday === 0 ? 'open' : 'closing', targetWeek, closeDate: addIsoDays(targetWeek, -5) }
}

/** Alerts that only ever go to the people who run the schedule (a decision is waiting for them). */
const MANAGER_KINDS = new Set(['swap.awaiting', 'request.new', 'request.cancelled', 'availability.submitted'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Where tapping an alert goes, on the phone and in the notification list alike: the thing the message is about.
 *  A link.url the app wrote itself wins (only a plain same-origin path is honoured, so a stored value can never
 *  become an open redirect), which is how a checklist alert names its exact checklist. Otherwise the kind decides,
 *  with the scheduler's own `tab` / `weekStart` hints. `manager` says the person can open the manager's schedule
 *  (an owner or general manager): the same swap alert goes to the employee's tab for one and the manager's for the other. */
export function pushPathFor(kind: string, link: Record<string, unknown> | null, recipient?: { manager?: boolean }): string {
  const url = link?.url
  if (typeof url === 'string' && /^\/(?!\/)[A-Za-z0-9/_\-?=&%.]*$/.test(url)) return url
  if (kind === 'checklist.gap') return '/owner/checklists'
  if (kind.startsWith('checklist.')) return '/staff/checklists'
  if (kind === 'requests.open' || kind === 'requests.closing') return '/staff/schedule?tab=availability'
  const week = typeof link?.weekStart === 'string' && ISO_DATE.test(link.weekStart) ? link.weekStart : null
  const asManager = MANAGER_KINDS.has(kind) || (kind === 'swap.cancelled' && recipient?.manager === true)
  if (asManager) return `/owner/schedule?tab=requests${week ? `&week=${week}` : ''}`
  if (kind.startsWith('swap.') || kind.startsWith('request.') || link?.tab === 'requests') return `/staff/schedule?tab=requests${week ? `&week=${week}` : ''}`
  return week ? `/staff/schedule?week=${week}` : '/staff/schedule'
}
