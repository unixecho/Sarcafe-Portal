// Wall-clock arithmetic — no Date math on shift times themselves (a Shift
// is a date + "HH:MM" pair, never a timestamp), so none of this depends on
// timezone. Weeks start Sunday (Israeli convention), matching
// shift_settings.working_days' 0=Sun..6=Sat default.

import type { HM, ISODate, Shift, WallClock } from './types'

export function toMinutes(hm: HM): number {
  const [h, m] = hm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function fromMinutes(mins: number): HM {
  const wrapped = ((mins % (24 * 60)) + 24 * 60) % (24 * 60)
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function crossesMidnight(shift: Pick<Shift, 'startTime' | 'endTime'>): boolean {
  return toMinutes(shift.endTime) <= toMinutes(shift.startTime)
}

export function durationMinutes(shift: Pick<Shift, 'startTime' | 'endTime'>): number {
  const start = toMinutes(shift.startTime)
  const end = toMinutes(shift.endTime)
  return (crossesMidnight(shift) ? 24 * 60 : 0) + end - start
}

/** Absolute minutes since the week's Sunday 00:00 — the shared axis
 *  overlap/rest checks compare on, so a shift ending Tuesday 02:00 (from a
 *  Monday 22:00 start) and one starting Tuesday 08:00 compare correctly
 *  even though they're on "different" calendar days. */
export function intervalOf(weekStart: ISODate, shift: Pick<Shift, 'date' | 'startTime' | 'endTime'>): { start: number; end: number } {
  const dayOffset = daysBetween(weekStart, shift.date)
  const start = dayOffset * 24 * 60 + toMinutes(shift.startTime)
  const end = start + durationMinutes(shift)
  return { start, end }
}

export function daysBetween(from: ISODate, to: ISODate): number {
  const a = parseISODate(from)
  const b = parseISODate(to)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

export function parseISODate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1))
}

export function formatISODate(date: Date): ISODate {
  return date.toISOString().slice(0, 10)
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = parseISODate(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return formatISODate(d)
}

/** The Sunday on or before `iso`. */
export function weekStartOf(iso: ISODate): ISODate {
  const d = parseISODate(iso)
  const dow = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() - dow)
  return formatISODate(d)
}

export function todayISO(): ISODate {
  return formatISODate(new Date())
}

export function weekDates(weekStart: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

/** Upcoming Sunday's requests close after the preceding Tuesday (Jerusalem wall clock). */
export function requestDeadline(weekStart: ISODate): ISODate {
  return addDays(weekStartOf(weekStart), -5)
}

export function requestsOpen(weekStart: ISODate, now: WallClock): boolean {
  return now.date <= requestDeadline(weekStart)
}

const WEEKDAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

export function weekdayLabel(dayOfWeek: number): string {
  return WEEKDAY_LABELS[dayOfWeek] ?? ''
}

export function formatDateLabel(iso: ISODate): string {
  const d = parseISODate(iso)
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'UTC' })
}

export function formatHours(mins: number): string {
  const h = Math.floor(Math.abs(mins) / 60)
  const m = Math.abs(mins) % 60
  const sign = mins < 0 ? '-' : ''
  return m === 0 ? `${sign}${h} ש׳` : `${sign}${h}:${String(m).padStart(2, '0')} ש׳`
}

// ---- Labels shared by EVERY screen ---------------------------------------------
// One place decides how a shift is written, so the week board, the shift sheet,
// the employee view, requests, swaps and notifications can never disagree about
// "07:00–13:00". formatShiftLabel() is the TS twin of sched_fmt() in migration
// 024 (the same text is baked into notifications server-side) — scripts/
// check-schedule.mjs asserts they agree.

const WEEKDAY_LONG = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'יום שבת']

export function weekdayLongLabel(dayOfWeek: number): string {
  return WEEKDAY_LONG[dayOfWeek] ?? ''
}

/** "07:00–13:00" */
export function formatShiftRange(startTime: HM, endTime: HM): string {
  return `${startTime}–${endTime}`
}

/** "יום שלישי 29/9" */
export function formatDayLabel(iso: ISODate): string {
  const d = parseISODate(iso)
  return `${weekdayLongLabel(d.getUTCDay())} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`
}

// A time range inside a Hebrew sentence must keep its digits in clock order. Without an isolate the
// bidi algorithm lays "07:00–13:00" out right-to-left, so it READS "13:00–07:00" to anyone scanning
// the digits. U+2066 (LRI) … U+2069 (PDI) pin the range left-to-right, the same thing the screens do
// with .ltr-isolate — and the same marks sched_fmt() writes into notifications server-side.
const LRI = '⁦'
const PDI = '⁩'

/** "07:00–13:00", isolated so it reads the same way inside any RTL sentence. */
export function isolatedRange(startTime: HM, endTime: HM): string {
  return `${LRI}${formatShiftRange(startTime, endTime)}${PDI}`
}

/** "יום שלישי 29/9 · 07:00–13:00" */
export function formatShiftLabel(date: ISODate, startTime: HM, endTime: HM): string {
  return `${formatDayLabel(date)} · ${isolatedRange(startTime, endTime)}`
}

/** "היום" / "מחר" / null — relative to the BRANCH's own clock, not the browser's. */
export function relativeDayLabel(date: ISODate, now: WallClock): string | null {
  if (date === now.date) return 'היום'
  if (date === addDays(now.date, 1)) return 'מחר'
  return null
}

/** Has this shift already started? Compared on the branch's wall clock (strings
 *  sort correctly: ISO date, then zero-padded HH:MM) — the same decision
 *  sched_is_past() makes in SQL. */
export function hasStarted(shift: Pick<Shift, 'date' | 'startTime'>, now: WallClock): boolean {
  if (shift.date !== now.date) return shift.date < now.date
  return shift.startTime <= now.time
}

/** The branch's current date + time on its own clock. Server-side. */
export function wallClockNow(timeZone: string, at: Date = new Date()): WallClock {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
    const hour = get('hour') === '24' ? '00' : get('hour')
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` }
  } catch {
    const iso = at.toISOString()
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) }
  }
}

export const HM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** True when both ends are valid HH:MM and the shift has a length. */
export function isValidShiftTimes(startTime: string, endTime: string): boolean {
  return HM_PATTERN.test(startTime) && HM_PATTERN.test(endTime) && startTime !== endTime
}

/** "לפני 5 דקות" / "לפני 3 שעות" / "אתמול" / "29/9" — for how long a request has been waiting. */
export function timeAgoHe(iso: string, nowMs: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const mins = Math.max(0, Math.round((nowMs - then) / 60_000))
  if (mins < 1) return 'ממש עכשיו'
  if (mins < 60) return mins === 1 ? 'לפני דקה' : `לפני ${mins} דקות`
  const hours = Math.round(mins / 60)
  if (hours < 24) return hours === 1 ? 'לפני שעה' : `לפני ${hours} שעות`
  const days = Math.round(hours / 24)
  if (days === 1) return 'אתמול'
  if (days < 7) return `לפני ${days} ימים`
  const d = new Date(then)
  return `${d.getDate()}/${d.getMonth() + 1}`
}
