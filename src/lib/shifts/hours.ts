// Branch OPERATING hours — read-only view onto shift_settings.{working_days,
// open_time, close_time, day_hours} (the "שעות פעילות" section of
// ManagerPanel.tsx), deliberately NOT derived from actual `shifts` rows.
// Shifts start before opening and end after closing (setup/teardown), so
// "is anyone on shift right now" and "are we open to customers right now"
// are two different questions — this module only ever answers the second
// one. Used both to gate the live-availability tablet feature (only
// operational during operating hours) and to show customers today's hours.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { hoursForDay } from './config'
import { toMinutes } from './time'
import type { HM } from './types'

export type DayHours = { open: HM; close: HM }

export type BranchOpenState = {
  /** Today's configured hours in the branch's own timezone, or null when
   * today isn't a working day at all (or hours were never configured). */
  hoursToday: DayHours | null
  /** Whether the branch is inside its operating-hours window right now. */
  openNow: boolean
}

type RawSettings = {
  working_days: number[] | null
  open_time: string | null
  close_time: string | null
  day_hours: Record<number, DayHours> | null
}

// Not a working day: real, intentional data — gating should treat this as
// closed. Distinct from "never configured" below, which fails open instead.
const CLOSED: BranchOpenState = { hoursToday: null, openNow: false }

// No shift_settings row at all (a brand-new branch that's never had its
// schedule settings opened) or a read error. Fails open, same posture as
// lib/settings/server.ts's readSetting(): missing configuration must never
// brick the tablet feature or hide the public menu's live counts — it only
// means "hours aren't configured yet," not "closed."
const UNCONFIGURED: BranchOpenState = { hoursToday: null, openNow: true }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function partsInTimezone(timezone: string, at: Date): { dayOfWeek: number; hm: HM } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at)

    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''
    let hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
    if (hour === '24') hour = '00' // known ICU quirk at midnight with hourCycle:'h23'

    const dayOfWeek = WEEKDAYS.indexOf(weekday)
    return { dayOfWeek: dayOfWeek < 0 ? at.getUTCDay() : dayOfWeek, hm: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}` }
  } catch {
    // Malformed/unknown timezone string — fall back to UTC rather than
    // throwing and taking the public menu page down with it.
    return { dayOfWeek: at.getUTCDay(), hm: `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}` }
  }
}

/** Pure — no I/O, safe to unit-test and to call from either a single-branch
 * or bulk lookup. */
export function computeOpenState(settings: RawSettings | null | undefined, timezone: string, at: Date = new Date()): BranchOpenState {
  if (!settings) return UNCONFIGURED

  const workingDays = settings.working_days ?? [0, 1, 2, 3, 4, 5, 6]
  const openTime = settings.open_time ?? '07:00'
  const closeTime = settings.close_time ?? '19:00'
  const dayHours = settings.day_hours ?? {}

  const { dayOfWeek, hm } = partsInTimezone(timezone, at)
  if (!workingDays.includes(dayOfWeek)) return CLOSED

  const hours = hoursForDay(dayOfWeek, openTime, closeTime, dayHours)
  const nowMin = toMinutes(hm)
  const openMin = toMinutes(hours.open)
  const closeMin = toMinutes(hours.close)

  // close <= open means the window crosses midnight (e.g. 20:00–02:00) —
  // same convention lib/shifts/time.ts's crossesMidnight uses for shifts.
  const openNow = closeMin <= openMin ? nowMin >= openMin || nowMin < closeMin : nowMin >= openMin && nowMin < closeMin

  return { hoursToday: hours, openNow }
}

async function fetchSettingsMap(branchIds: string[]): Promise<Map<string, RawSettings>> {
  const map = new Map<string, RawSettings>()
  if (branchIds.length === 0) return map
  try {
    const service = createServiceRoleClient()
    const { data } = await service
      .from('shift_settings')
      .select('branch_id, working_days, open_time, close_time, day_hours')
      .in('branch_id', branchIds)
    for (const row of (data ?? []) as Array<RawSettings & { branch_id: string }>) {
      map.set(row.branch_id, row)
    }
  } catch {
    // Every branch resolves via computeOpenState's UNCONFIGURED fail-open
    // path below instead.
  }
  return map
}

/** Bulk lookup for listing pages (portal branch picker, public menu) — one
 * shift_settings query for every branch instead of one round trip each. */
export async function getBranchOpenStates(
  branches: { id: string; timezone: string }[],
  at: Date = new Date()
): Promise<Record<string, BranchOpenState>> {
  const settingsMap = await fetchSettingsMap(branches.map((b) => b.id))
  const result: Record<string, BranchOpenState> = {}
  for (const branch of branches) {
    result[branch.id] = computeOpenState(settingsMap.get(branch.id), branch.timezone, at)
  }
  return result
}

/** Single-branch gating check — used to decide whether the live-availability
 * tablet feature may be used/published right now. Fails open (returns true)
 * on any read error or missing row, matching this app's settings convention
 * that an outage must never brick a feature, only skip its restriction. */
export async function isWithinOperatingHours(branchId: string, at: Date = new Date()): Promise<boolean> {
  try {
    const service = createServiceRoleClient()
    const [{ data: branch }, { data: settings }] = await Promise.all([
      service.from('branches').select('timezone').eq('id', branchId).maybeSingle(),
      service
        .from('shift_settings')
        .select('working_days, open_time, close_time, day_hours')
        .eq('branch_id', branchId)
        .maybeSingle(),
    ])
    if (!branch) return true
    return computeOpenState(settings as RawSettings | null, branch.timezone as string, at).openNow
  } catch {
    return true
  }
}
