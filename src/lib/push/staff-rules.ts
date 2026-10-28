// The pure rules behind staff push: when a reminder falls due and where tapping an alert goes.
// No server-only imports and no '@/' imports on purpose, so scripts/check-staff-push.mjs runs the real code.

import type { WallClock } from '@/lib/shifts/types'

// ---- Shift reminders (the person's own shifts) ----------------------------------------------
/** "Your next shift is…" goes out to everyone who has one, every day at this local hour, whatever time that shift is
 *  (a 07:00 shift tomorrow, a 17:00 one tomorrow, a 20:00 one tonight, or one three days away). Owner, 2026-10-28. */
export const NEXT_SHIFT_HOUR = 19
/** A next-shift notice that missed its hour (the scheduler was down) is still sent this long after it, then dropped. */
export const NEXT_SHIFT_WINDOW_MINUTES = 3 * 60
/** How far ahead "next shift" looks: a person whose next published shift is further away than this hears nothing. */
export const NEXT_SHIFT_LOOKAHEAD_DAYS = 8
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

// ---- The owner's morning report: what is missing or not working ----------------------------------
/** The owners' daily "what is missing or not working" summary goes out at this local hour (only when something is open). */
export const ISSUES_DIGEST_HOUR = 8
/** A digest that missed its hour (the scheduler was down) is still sent this long after it, then skipped for the day. */
export const ISSUES_DIGEST_WINDOW_MINUTES = 3 * 60

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

/** Is the shift's "you work today" reminder due right now: from 07:00 on the day, until the shift is over.
 *  (The evening-before reminder is now the daily next-shift notice below, which is not tied to one shift.) */
export function shiftReminderPhase(shift: { date: string; startTime: string; endTime: string }, now: WallClock): 'today' | null {
  if (shift.date !== now.date) return null
  const since = minutesOf(now.time) - SHIFT_TODAY_HOUR * 60
  return since >= 0 && since < SHIFT_REMINDER_WINDOW_MINUTES && endAbs(shift) > nowAbs(now) ? 'today' : null
}

// ---- The daily "your next shift" notice (19:00) ---------------------------------------------------
/** True from NEXT_SHIFT_HOUR until the window ends, on the branch's own clock. */
export function nextShiftDue(now: WallClock): boolean {
  const since = minutesOf(now.time) - NEXT_SHIFT_HOUR * 60
  return since >= 0 && since < NEXT_SHIFT_WINDOW_MINUTES
}

export type UpcomingShift = { date: string; startTime: string; endTime: string; line: string }

/** A person's next shift day: every shift that has not started yet, on the earliest date that has one. */
export function nextShiftDay<T extends UpcomingShift>(shifts: T[], now: WallClock): { date: string; shifts: T[] } | null {
  const ahead = shifts.filter((s) => startAbs(s) > nowAbs(now)).sort((a, b) => startAbs(a) - startAbs(b) || a.line.localeCompare(b.line))
  if (ahead.length === 0) return null
  const date = ahead[0]!.date
  return { date, shifts: ahead.filter((s) => s.date === date) }
}

const WEEKDAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
/** "היום", "מחר", else "יום חמישי 29/10". */
export function nextShiftWhen(date: string, now: WallClock): string {
  const days = dayNumber(date) - dayNumber(now.date)
  if (days === 0) return 'היום'
  if (days === 1) return 'מחר'
  return `יום ${WEEKDAY_NAMES[weekdayOf(date)]} ${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`
}

/** "המשמרת הבאה שלך: מחר 07:00": the time is in the title so a lock screen already says it. */
export function nextShiftTitle(day: { date: string; shifts: UpcomingShift[] }, now: WallClock): string {
  return `המשמרת הבאה שלך: ${nextShiftWhen(day.date, now)} ${day.shifts[0]!.startTime.slice(0, 5)}`
}

/** True from ISSUES_DIGEST_HOUR until the window ends, on the branch's own clock. */
export function issuesDigestDue(now: WallClock): boolean {
  const since = minutesOf(now.time) - ISSUES_DIGEST_HOUR * 60
  return since >= 0 && since < ISSUES_DIGEST_WINDOW_MINUTES
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
const MANAGER_KINDS = new Set(['swap.awaiting', 'request.new', 'request.cancelled', 'availability.submitted', 'availability.note', 'timeoff.new', 'timeoff.wish', 'timeoff.cancelled'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Who an alert is FOR. The developer account is employee, manager, owner and developer at once, so on that account the
 *  same bell holds all four kinds of alert; the title says which (owner, 2026-10-16: "if I get a notification meant for dev
 *  or owner, mention it ... for owner and employee don't add prefixes"). Only the developer's own copy gets a prefix:
 *  an owner or an employee reads the title as written. */
export type AlertAudience = 'developer' | 'owner' | 'employee'
/** Management alerts: the checklist escalation and the morning report, and everything that waits for a manager's decision. */
const OWNER_KINDS = new Set(['checklist.gap', 'issues.digest', 'club.signup', ...MANAGER_KINDS])
/** Two kinds are written for BOTH the person a request or swap concerns ("הבקשה שלך בוטלה") and for the managers
 *  ("דנה ביטל/ה בקשה להצטרף למשמרת"), with the same `kind`. The title is what tells the two copies apart. */
const BOTH_COPIES = new Set(['request.cancelled', 'swap.cancelled'])
const MANAGER_COPY_TITLE = /המתינה לאישור|להצטרף למשמרת/
/** A row the developer's test bench wrote: it is a test of the system, not an alert for the person who reads it. */
export const isTestAlert = (title: string | null | undefined) => typeof title === 'string' && title.includes('(בדיקה)')
/** True when this copy of an alert is the managers' copy. `title` unknown = the old answer (request.cancelled is the managers'). */
function isManagerCopy(kind: string, title?: string | null): boolean {
  if (BOTH_COPIES.has(kind) && typeof title === 'string') return MANAGER_COPY_TITLE.test(title)
  return MANAGER_KINDS.has(kind)
}
export function alertAudience(kind: string, title?: string | null): AlertAudience {
  if (kind.startsWith('dev.')) return 'developer'
  if (BOTH_COPIES.has(kind) && typeof title === 'string') return MANAGER_COPY_TITLE.test(title) ? 'owner' : 'employee'
  return OWNER_KINDS.has(kind) ? 'owner' : 'employee'
}
/** Which of the developer's three notification containers an alert belongs to (/staff/dev, "התראות"): system and test alerts,
 *  alerts meant for a manager or owner, and alerts meant for the person as an employee. Test rows are the developer's own
 *  business whatever they imitate, so they go to the first, and the other two hold only what is real. */
export function notificationAudience(kind: string, title?: string | null): AlertAudience {
  return isTestAlert(title) ? 'developer' : alertAudience(kind, title)
}
export const AUDIENCE_PREFIX: Record<AlertAudience, string> = { developer: 'מפתח · ', owner: 'בעלים · ', employee: '' }
/** The title a person should read. `recipient.developer` is true only for the developer account. Idempotent. */
export function alertTitle(kind: string, title: string, recipient: { developer?: boolean } | null | undefined): string {
  if (!recipient?.developer) return title
  const prefix = AUDIENCE_PREFIX[alertAudience(kind, title)]
  return prefix && !title.startsWith(prefix) ? `${prefix}${title}` : title
}

/** Where tapping an alert goes, on the phone and in the notification list alike: the thing the message is about.
 *  A link.url the app wrote itself wins (only a plain same-origin path is honoured, so a stored value can never
 *  become an open redirect), which is how a checklist alert names its exact checklist. Otherwise the kind decides,
 *  with the scheduler's own `tab` / `weekStart` hints. `manager` says the person can open the manager's schedule
 *  (an owner or general manager): the same swap alert goes to the employee's tab for one and the manager's for the other. */
export function pushPathFor(kind: string, link: Record<string, unknown> | null, recipient?: { manager?: boolean; title?: string | null }): string {
  const url = link?.url
  if (typeof url === 'string' && /^\/(?!\/)[A-Za-z0-9/_\-?=&%.]*$/.test(url)) return url
  if (kind === 'checklist.gap') return '/owner/checklists'
  if (kind === 'issues.digest') return '/owner/issues'
  if (kind.startsWith('checklist.')) return '/staff/checklists'
  if (kind === 'requests.open' || kind === 'requests.closing') return '/staff/schedule?tab=availability'
  // The owner's answer to a day off lands where the person asked for it (a manager's own copy of timeoff.new is handled below).
  if (kind === 'timeoff.decided') return '/staff/schedule?tab=availability'
  const week = typeof link?.weekStart === 'string' && ISO_DATE.test(link.weekStart) ? link.weekStart : null
  // A manager's copy goes to the manager's schedule. For the two kinds that serve both audiences the TITLE says which copy this is
  // (a developer is a manager AND an employee, so the recipient alone cannot say); without a title swap.cancelled follows the recipient.
  const asManager = BOTH_COPIES.has(kind) && typeof recipient?.title === 'string'
    ? isManagerCopy(kind, recipient.title)
    : MANAGER_KINDS.has(kind) || (kind === 'swap.cancelled' && recipient?.manager === true)
  if (asManager) return `/owner/schedule?tab=requests${week ? `&week=${week}` : ''}`
  // An approved request is now the person's shift: show the schedule. Everything else about a request or swap waits in the requests tab.
  if (link?.tab === 'schedule') return `/staff/schedule?tab=schedule${week ? `&week=${week}` : ''}`
  if (kind.startsWith('swap.') || kind.startsWith('request.') || link?.tab === 'requests') return `/staff/schedule?tab=requests${week ? `&week=${week}` : ''}`
  return week ? `/staff/schedule?week=${week}` : '/staff/schedule'
}
