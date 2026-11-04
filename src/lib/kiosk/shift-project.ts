// "Who is on shift, and when does the place close" for the kiosk's header, as a pure projection of the published shifts of
// ONE branch. No imports, no database, no clock unless one is passed, so scripts/check-kiosk-device.mjs runs this very
// file. The minute arithmetic is the same as lib/checklists/window.ts (a shift that ends at or before its start ends on
// the next day: 16:00-00:00 and 20:00-02:00 work); the check compares the two on the same shifts.
//
// Closing time. The end of the shift that is running is the wrong answer for a customer when the next shift takes over
// at that minute (at 13:00 a 07:00-14:00 morning shift followed by a 14:00-22:00 evening one means the place is open until
// 22:00, not 14:00). So the closing time is the end of the CHAIN: the end of the running shifts, pushed later for as long
// as another shift is already running at that end or starts exactly then. A gap (a break between two shifts) ends the chain.

export type ShiftTimes = { date: string; startTime: string; endTime: string }
export type ShiftWithPeople = ShiftTimes & { names: string[] }
export type ShiftNow = { people: string[]; closesAt: string | null }

const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
const abs = (date: string, minutes: number) => dayNumber(date) * 1440 + minutes

export const shiftStart = (s: ShiftTimes) => abs(s.date, minutesOf(s.startTime))
export const shiftEnd = (s: ShiftTimes) => {
  const start = minutesOf(s.startTime)
  const end = minutesOf(s.endTime)
  return shiftStart(s) + (end > start ? end - start : 24 * 60 - start + end)
}
export const clockMinute = (clock: { date: string; time: string }) => abs(clock.date, minutesOf(clock.time))

/** "07:05" from an absolute minute (the day it falls on does not matter to a customer). */
export function hm(absMinute: number): string {
  const m = ((absMinute % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** The absolute minute the place stops being staffed, or null when no shift is running at `now`. */
export function closingMinute(all: ShiftTimes[], now: number): number | null {
  const running = all.filter((s) => shiftStart(s) <= now && now < shiftEnd(s))
  if (running.length === 0) return null
  let end = Math.max(...running.map(shiftEnd))
  // every pass strictly moves `end` later, so this ends after at most one pass per shift
  for (let pass = 0; pass < all.length; pass += 1) {
    const more = all.filter((s) => shiftStart(s) <= end && shiftEnd(s) > end)
    if (more.length === 0) break
    end = Math.max(...more.map(shiftEnd))
  }
  return end
}

/** The first word of a name, short enough for a header ("דנה כהן" -> "דנה"). */
export function firstName(raw: string): string {
  const word = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().split(/\s+/)[0] ?? ''
  return word.length > 14 ? `${word.slice(0, 13)}…` : word
}

export const MAX_PEOPLE = 6

export function projectShift(shifts: ShiftWithPeople[], clock: { date: string; time: string }): ShiftNow {
  const now = clockMinute(clock)
  const running = shifts
    .filter((s) => shiftStart(s) <= now && now < shiftEnd(s))
    .sort((a, b) => shiftStart(a) - shiftStart(b))
  const seen = new Set<string>()
  const people: string[] = []
  for (const shift of running) {
    for (const raw of [...shift.names].sort((a, b) => a.localeCompare(b, 'he'))) {
      const name = firstName(raw)
      const key = name.toLocaleLowerCase()
      if (!name || seen.has(key)) continue
      seen.add(key)
      people.push(name)
    }
  }
  const end = closingMinute(shifts, now)
  return { people: people.slice(0, MAX_PEOPLE), closesAt: end === null ? null : hm(end) }
}
