// Operating hours, the way a manager thinks of them (one row per day: open or
// closed, from when to when) versus the way they are stored (the open days, one
// DEFAULT pair of hours, and sparse per-day overrides).
//
// The stored shape used to be edited as two separate controls, "the usual hours"
// and "special hours for one day". A special entry silently beats the usual hours,
// so changing the usual ones left a day with an old entry showing the old time to
// customers — with nothing on screen saying why. Editing now goes through the
// week: whatever is written back is derived from it, so the usual hours are always
// what most days have and an override exists only where a day really differs.
//
// Pure (no I/O, no React): the customer-facing pages read the same four stored
// fields through lib/shifts/hours.ts, and the editor's preview reads them through
// effectiveWeek() here, so what the manager sees is what the customer sees.

import { hoursForDay } from './config'
import { parseISODate, toMinutes } from './time'
import type { HM, ShiftSettings, WallClock } from './types'

export type DayHours = { open: HM; close: HM }
export type HoursSettings = Pick<ShiftSettings, 'workingDays' | 'openTime' | 'closeTime' | 'dayHours'>
export type HoursWeek = (DayHours | null)[]

const FALLBACK: DayHours = { open: '07:00', close: '19:00' }

/** Each day Sunday..Saturday: its hours, or null when the branch is closed. This is what customers are shown. */
export function effectiveWeek(settings: HoursSettings): HoursWeek {
  return Array.from({ length: 7 }, (_, day) => (settings.workingDays.includes(day) ? hoursForDay(day, settings.openTime, settings.closeTime, settings.dayHours) : null))
}

/**
 * The stored form of an edited week. The default hours are the pair most open days share (the earliest
 * day wins a tie), and only the days that differ from it get an override. `keep` is used when every day
 * is closed, so the default a branch had is not lost.
 */
export function settingsFromWeek(week: HoursWeek, keep: DayHours = FALLBACK): HoursSettings {
  const key = (h: DayHours) => `${h.open}|${h.close}`
  const counts = new Map<string, number>()
  for (const h of week) if (h) counts.set(key(h), (counts.get(key(h)) ?? 0) + 1)
  let usual = keep
  let best = 0
  for (const h of week) {
    const n = h ? counts.get(key(h))! : 0
    if (h && n > best) {
      usual = h
      best = n
    }
  }
  const dayHours: HoursSettings['dayHours'] = {}
  week.forEach((h, day) => {
    if (h && key(h) !== key(usual)) dayHours[day] = { open: h.open, close: h.close }
  })
  return { workingDays: week.flatMap((h, day) => (h ? [day] : [])), openTime: usual.open, closeTime: usual.close, dayHours }
}

/** A closed day opened again starts from the hours most days have, not from 00:00. */
export function usualHours(settings: HoursSettings): DayHours {
  return { open: settings.openTime, close: settings.closeTime }
}

/** Is the branch inside today's hours right now? Same rule as the server (a close at or before the open crosses midnight). */
export function openStatus(week: HoursWeek, now: WallClock): { today: DayHours | null; openNow: boolean } {
  const today = week[parseISODate(now.date).getUTCDay()] ?? null
  if (!today) return { today: null, openNow: false }
  const at = toMinutes(now.time)
  const open = toMinutes(today.open)
  const close = toMinutes(today.close)
  return { today, openNow: close <= open ? at >= open || at < close : at >= open && at < close }
}
