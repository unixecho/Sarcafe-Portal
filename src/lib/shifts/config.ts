// Seed data a branch's shift_settings starts from — overwritten freely by
// ManagerPanel/CatalogEditor, not runtime-hardcoded logic. A coffee truck
// needs far fewer roles/stations than a bar, so this is Sarcafe's own
// list, not a port of AyekaBar's bartender/waiter/cook set.

import type { SafetyRules, ShiftPreset, ShiftRole, Station } from './types'

export const DEFAULT_ROLES: ShiftRole[] = [
  { id: 'barista', name: 'בריסטה', color: '#ff8a5c' },
  { id: 'cashier', name: 'קופה', color: '#57d9c0' },
  { id: 'shift_lead', name: 'אחראי/ת משמרת', color: '#f472b6' },
]

export const DEFAULT_STATIONS: Station[] = [
  { id: 'counter', name: 'דוכן', emoji: '☕' },
  { id: 'prep', name: 'הכנה', emoji: '🥐' },
]

export const DEFAULT_PRESETS: ShiftPreset[] = [
  { id: 'morning', name: 'בוקר', startTime: '07:00', endTime: '15:00' },
  { id: 'evening', name: 'ערב', startTime: '15:00', endTime: '19:00' },
]

export const DEFAULT_SAFETY: SafetyRules = {
  maxWeeklyHours: 42,
  minRestHours: 10,
  maxDailyHours: 10,
  maxConsecutiveDays: 6,
}

/** UI slider/stepper bounds — keeps the owner from typing in a value the
 *  rules engine would treat as nonsensical (e.g. 0-hour rest). */
export const SAFETY_BOUNDS = {
  maxWeeklyHours: { min: 20, max: 60, step: 1 },
  minRestHours: { min: 6, max: 16, step: 0.5 },
  maxDailyHours: { min: 4, max: 14, step: 0.5 },
  maxConsecutiveDays: { min: 3, max: 10, step: 1 },
} as const

export function hoursForDay(
  dayOfWeek: number,
  openTime: string,
  closeTime: string,
  dayHours: Record<number, { open: string; close: string }>
): { open: string; close: string } {
  return dayHours[dayOfWeek] ?? { open: openTime, close: closeTime }
}

/** A small, fixed accent palette for role/station chips — cycled by
 *  index when the owner adds a new one, so colors stay visually distinct
 *  without the owner having to pick one by hand. */
export const ACCENT_COLORS = ['#ff8a5c', '#57d9c0', '#f472b6', '#60a5fa', '#fbbf24', '#4ade80', '#c084fc', '#fb7185']
