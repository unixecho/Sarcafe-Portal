// Days off and shift wishes (see supabase/migrations/20261015091000_staff_time_off.sql). Pure on purpose, like
// time.ts / rules.ts: the board, the pickers, the warnings and the employee's own form all read the same facts here,
// and scripts/check-schedule.mjs runs this very file (including against the SQL twin of shiftPeriods).
//
//   day_off     needs the owner's yes. Approved = the person cannot be scheduled anywhere that day. Pending = a request.
//   no_morning  soft wishes ("I would rather not"), never blocking: the owner sees them while building the
//   no_evening  schedule and may still schedule the person.

import type { ISODate, TimeOffEntry, TimeOffKind } from './types'

export const TIME_OFF_KINDS: readonly TimeOffKind[] = ['day_off', 'no_morning', 'no_evening']

export type ShiftPeriod = 'morning' | 'evening'

/** Minutes after midnight that split a day into "morning" and "evening". */
const SPLIT = 13 * 60

const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/** Which half of the day a shift touches: 'morning' when it starts before 13:00, 'evening' when it ends after 13:00
 *  or runs past midnight. 07:00–13:00 is morning, 13:00–19:00 evening, 07:00–19:00 both.
 *  KEEP IN SYNC with sched_shift_periods() in the 20261015091000 migration. */
export function shiftPeriods(startTime: string, endTime: string): ShiftPeriod[] {
  const start = minutesOf(startTime)
  const end = minutesOf(endTime)
  const out: ShiftPeriod[] = []
  if (start < SPLIT) out.push('morning')
  if (end > SPLIT || end <= start) out.push('evening')
  return out
}

/** A request that still counts: waiting, approved, or a noted wish (declined and cancelled are history). */
export const isLiveTimeOff = (entry: Pick<TimeOffEntry, 'status'>) => entry.status === 'pending' || entry.status === 'approved' || entry.status === 'noted'

/** What one person asked for on one day. */
export type DayWishes = { dayOff: 'approved' | 'pending' | null; avoid: ShiftPeriod[] }

export function wishesOn(entries: readonly TimeOffEntry[], staffId: string, date: ISODate): DayWishes {
  const mine = entries.filter((entry) => entry.staffId === staffId && entry.date === date && isLiveTimeOff(entry))
  const off = mine.find((entry) => entry.kind === 'day_off')
  return {
    dayOff: off ? (off.status === 'approved' ? 'approved' : 'pending') : null,
    avoid: [mine.some((entry) => entry.kind === 'no_morning') ? 'morning' : null, mine.some((entry) => entry.kind === 'no_evening') ? 'evening' : null].filter((x): x is ShiftPeriod => x !== null),
  }
}

/** How a person stands against a shift they could be given:
 *   day_off          an approved day off: the database will refuse (blocked everywhere, every branch)
 *   day_off_pending  they asked for the day off and nobody has answered yet
 *   avoids           they would rather not work that half of the day (the owner may still choose them)
 *   fine             nothing in the way */
export type ShiftFit = { kind: 'day_off' | 'day_off_pending' | 'avoids' | 'fine'; avoids: ShiftPeriod[] }

export function fitFor(entries: readonly TimeOffEntry[], staffId: string, shift: { date: ISODate; startTime: string; endTime: string }): ShiftFit {
  const wishes = wishesOn(entries, staffId, shift.date)
  if (wishes.dayOff === 'approved') return { kind: 'day_off', avoids: [] }
  if (wishes.dayOff === 'pending') return { kind: 'day_off_pending', avoids: [] }
  const touched = shiftPeriods(shift.startTime, shift.endTime)
  const avoids = wishes.avoid.filter((period) => touched.includes(period))
  return avoids.length > 0 ? { kind: 'avoids', avoids } : { kind: 'fine', avoids: [] }
}

export const PERIOD_LABEL: Record<ShiftPeriod, string> = { morning: 'בוקר', evening: 'ערב' }
export const KIND_LABEL: Record<TimeOffKind, string> = { day_off: 'יום חופש', no_morning: 'בלי משמרת בוקר', no_evening: 'בלי משמרת ערב' }

/** "בלי בוקר" / "בלי ערב" / "בלי בוקר וערב": the short wish, for chips and pills. */
export const avoidText = (avoids: readonly ShiftPeriod[]) => `בלי ${avoids.map((period) => PERIOD_LABEL[period]).join(' וגם ')}`
