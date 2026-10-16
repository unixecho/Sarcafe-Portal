// What an employee may ask for in a week (אילוצים) and the two limits the manager sets — PURE, no React, no
// Supabase. scripts/check-schedule.mjs runs this file; the employee's form, the manager's panel, the settings
// editor and the server (dispatch-write.ts) all read the same numbers from here.
//
// Owner, 2026-10-16 (modelled on the Ayeka Bar scheduler):
//   • an employee may ask for up to N DAYS OFF a week; the manager sets N (default 2);
//   • an employee may also say "I cannot do the morning shift" or "I cannot do the evening shift" on a day, and the
//     manager sets how many of those a week (M). Today there is NO limit: a missing or null M means "no limit";
//   • so each day offers three choices: לא יכול/ה משמרת בוקר · לא יכול/ה משמרת ערב · יום חופש כל היום, and a day takes
//     ONE of them: either one shift or the whole day (owner, 2026-10-16). Choosing another replaces the first.
//
// The limits live in `shift_settings.features` (an existing jsonb column), so there is no migration: a venue written
// before they existed simply has no keys, and the readers below turn that into the defaults.
//
// Saving is "the wanted state of the week" (see sched_submit_time_off), so the limits are checked against what the
// person WANTS after the save — with one kindness: a week that is already over a limit (the manager lowered it after
// people had asked) can be kept as it is or reduced, never increased. Nobody is locked out of removing something.

import type { ISODate, TimeOffKind } from './types'

/** Default days off a week when the manager has not chosen. */
export const DEFAULT_MAX_DAYS_OFF = 2
/** A week has seven days; 7 days off means "anything goes". */
export const MAX_DAYS_OFF_CEILING = 7
/** Seven mornings and seven evenings. */
export const MAX_SHIFT_BLOCKS_CEILING = 14

/** The days-off limit of a branch, from its `features` blob. Anything that is not a whole number 0..7 is the default. */
export function maxDaysOffOf(features: { maxDaysOff?: unknown } | null | undefined): number {
  const v = features?.maxDaysOff
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_DAYS_OFF_CEILING ? v : DEFAULT_MAX_DAYS_OFF
}

/** The limit on "cannot do the morning / evening" requests a week; null = no limit (the state of every branch today). */
export function maxShiftBlocksOf(features: { maxShiftBlocks?: unknown } | null | undefined): number | null {
  const v = features?.maxShiftBlocks
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_SHIFT_BLOCKS_CEILING ? v : null
}

export type Wanted = Record<ISODate, readonly TimeOffKind[]>
export type Counts = { daysOff: number; blocks: number }

/** How much of each limit a week's wishes use. A day off already covers both halves, so it never also counts as blocks. */
export function countWanted(wanted: Wanted): Counts {
  let daysOff = 0
  let blocks = 0
  for (const kinds of Object.values(wanted)) {
    if (kinds.includes('day_off')) { daysOff += 1; continue }
    if (kinds.includes('no_morning')) blocks += 1
    if (kinds.includes('no_evening')) blocks += 1
  }
  return { daysOff, blocks }
}

export type Limits = { maxDaysOff: number; maxShiftBlocks: number | null }
export const limitsOf = (features: { maxDaysOff?: unknown; maxShiftBlocks?: unknown } | null | undefined): Limits => ({
  maxDaysOff: maxDaysOffOf(features),
  maxShiftBlocks: maxShiftBlocksOf(features),
})

/** What is left of each limit (null blocks left = unlimited). Never negative. */
export function leftOf(counts: Counts, limits: Limits): { daysOff: number; blocks: number | null } {
  return {
    daysOff: Math.max(0, limits.maxDaysOff - counts.daysOff),
    blocks: limits.maxShiftBlocks === null ? null : Math.max(0, limits.maxShiftBlocks - counts.blocks),
  }
}

/** Would the save break a limit? `before` is what the person already had live that week: a limit that was already
 *  exceeded before (the manager lowered it afterwards) only refuses an INCREASE. */
export function breaks(after: Counts, before: Counts, limits: Limits): 'too_many_days_off' | 'too_many_shift_blocks' | null {
  if (after.daysOff > limits.maxDaysOff && after.daysOff > before.daysOff) return 'too_many_days_off'
  if (limits.maxShiftBlocks !== null && after.blocks > limits.maxShiftBlocks && after.blocks > before.blocks) return 'too_many_shift_blocks'
  return null
}

/** A day's choice after tapping `kind`: tapping the chosen one clears the day, tapping another REPLACES it. */
export function chooseKind(current: readonly TimeOffKind[], kind: TimeOffKind): TimeOffKind[] {
  return current.length === 1 && current[0] === kind ? [] : [kind]
}

/** Could the person tap this chip and still be inside the limits? (the form asks before it sets a chip) */
export function canAdd(wanted: Wanted, date: ISODate, kind: TimeOffKind, limits: Limits): boolean {
  const current = wanted[date] ?? []
  if (current.includes(kind)) return true
  const after = countWanted({ ...wanted, [date]: chooseKind(current, kind) })
  const before = countWanted(wanted)
  return breaks(after, before, limits) === null
}

/** Days that hold more than one choice. A week that already holds such a day (the first release let both halves be
 *  asked for) may keep exactly that; nothing may CREATE one. `before` is what the person already had live. */
export function multiChoiceDay(after: Wanted, before: Wanted): ISODate | null {
  for (const [date, kinds] of Object.entries(after)) {
    if (kinds.length <= 1) continue
    const had = before[date] ?? []
    const same = had.length === kinds.length && kinds.every((k) => had.includes(k))
    if (!same) return date
  }
  return null
}

/** "נשארו 2 ימי חופש" / "אין עוד ימי חופש": the counter above the form. */
export function daysOffLeftText(left: number): string {
  if (left <= 0) return 'ניצלתם את כל ימי החופש של השבוע'
  return left === 1 ? 'נשאר לכם יום חופש אחד' : `נשארו לכם ${left} ימי חופש`
}

/** The same for "cannot do morning/evening"; empty when there is no limit (nothing to count down). */
export function blocksLeftText(left: number | null): string {
  if (left === null) return ''
  if (left <= 0) return 'ניצלתם את כל חסימות המשמרות של השבוע'
  return left === 1 ? 'אפשר לחסום עוד משמרת אחת' : `אפשר לחסום עוד ${left} משמרות`
}

/** The manager's line about one person: "יום חופש 1/2 · חסימות 2". */
export function usageLabel(counts: Counts, limits: Limits): string {
  const parts = [`ימי חופש ${counts.daysOff}/${limits.maxDaysOff}`]
  if (counts.blocks > 0 || limits.maxShiftBlocks !== null) {
    parts.push(limits.maxShiftBlocks === null ? `משמרות חסומות ${counts.blocks}` : `משמרות חסומות ${counts.blocks}/${limits.maxShiftBlocks}`)
  }
  return parts.join(' · ')
}

/** Is the person over a limit right now (shown to the manager as a quiet warning)? */
export const overLimit = (counts: Counts, limits: Limits): boolean =>
  counts.daysOff > limits.maxDaysOff || (limits.maxShiftBlocks !== null && counts.blocks > limits.maxShiftBlocks)
