// Where a NEW shift's times come from. Pure — no React, no database.
//
// ROOT CAUSE this fixes: ShiftSheet used to hardcode 08:00–16:00 and never looked
// at the shift templates (presets) or the branch hours configured in Settings, so
// the time a manager saw when creating a shift had nothing to do with what they
// had set up.
//
// The model, stated once:
//   * a TEMPLATE (ShiftPreset) is a suggestion — "morning 07:00–13:00";
//   * a SHIFT owns its own explicit start/end. Creating a shift copies a
//     template's times into it (and remembers which template, as a label);
//   * editing a template later therefore never moves a shift already scheduled —
//     only shifts created afterwards start from the new times.

import { hoursForDay } from './config'
import type { HM, ISODate, ShiftPreset, ShiftSettings } from './types'
import { parseISODate } from './time'

export type DefaultTimes = { startTime: HM; endTime: HM; presetId: string | null; source: 'template' | 'hours' }

/** The branch's opening hours for one date (a per-weekday override, else the global hours). */
export function hoursFor(date: ISODate, settings: Pick<ShiftSettings, 'openTime' | 'closeTime' | 'dayHours'>): { open: HM; close: HM } {
  const dow = parseISODate(date).getUTCDay()
  return hoursForDay(dow, settings.openTime, settings.closeTime, settings.dayHours)
}

/**
 * The times a brand-new shift on `date` starts with:
 *   1. the first TEMPLATE that no shift on that day already uses (so adding a
 *      second shift to a day that has "morning" suggests "evening");
 *   2. else the first template;
 *   3. else (no templates configured) that day's opening hours.
 */
export function defaultTimesFor(
  date: ISODate,
  settings: Pick<ShiftSettings, 'presets' | 'openTime' | 'closeTime' | 'dayHours'>,
  existingOnDay: { startTime: HM; endTime: HM }[] = []
): DefaultTimes {
  const presets = settings.presets
  if (presets.length > 0) {
    const used = (p: ShiftPreset) => existingOnDay.some((s) => s.startTime === p.startTime && s.endTime === p.endTime)
    const pick = presets.find((p) => !used(p)) ?? presets[0]!
    return { startTime: pick.startTime, endTime: pick.endTime, presetId: pick.id, source: 'template' }
  }
  const hours = hoursFor(date, settings)
  return { startTime: hours.open, endTime: hours.close, presetId: null, source: 'hours' }
}

/** The template whose times these are exactly, if any (for highlighting a chip). */
export function matchPreset(times: { startTime: HM; endTime: HM }, presets: ShiftPreset[]): ShiftPreset | null {
  return presets.find((p) => p.startTime === times.startTime && p.endTime === times.endTime) ?? null
}
