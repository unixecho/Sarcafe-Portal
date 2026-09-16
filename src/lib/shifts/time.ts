// Wall-clock arithmetic — no Date math on shift times themselves (a Shift
// is a date + "HH:MM" pair, never a timestamp), so none of this depends on
// timezone. Weeks start Sunday (Israeli convention), matching
// shift_settings.working_days' 0=Sun..6=Sat default.

import type { HM, ISODate, Shift } from './types'

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
