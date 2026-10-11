// The scheduler's settings DRAFT. Every setting a manager can change (hours, open
// days, safety rules, feature switches, roles, stations, shift templates, who may
// be scheduled and with which default role / weekly cap, who manages the board)
// is edited in a local draft and written in ONE request when they press Save. No
// control talks to the server while it is being turned: a scroll wheel can land on
// a dozen numbers on its way to the right one.
//
// Pure (no React): the provider keeps the state, this decides what changed, what
// is invalid and what a person should be told.

import { SAFETY_BOUNDS } from './config'
import { HM_PATTERN, weekdayLabel } from './time'
import type { ScheduleStaffRow, ShiftSettings } from './types'

export const SETTINGS_KEYS = ['workingDays', 'openTime', 'closeTime', 'dayHours', 'roles', 'stations', 'presets', 'safety', 'features', 'scheduleManagers'] as const
export type SettingsKey = (typeof SETTINGS_KEYS)[number]
export type EditableSettings = Pick<ShiftSettings, SettingsKey>

/** The three per-person scheduling flags a manager edits in the roster. */
export type MemberPatch = { schedulable?: boolean; defaultRoleId?: string | null; maxWeeklyHours?: number | null }
const MEMBER_KEYS = ['schedulable', 'defaultRoleId', 'maxWeeklyHours'] as const

export type DraftState = { settings: Partial<EditableSettings>; members: Record<string, MemberPatch> }
export const EMPTY_DRAFT: DraftState = { settings: {}, members: {} }

type Remote = { settings: ShiftSettings; roster: ScheduleStaffRow[] }

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

export function editableOf(settings: ShiftSettings): EditableSettings {
  return Object.fromEntries(SETTINGS_KEYS.map((k) => [k, settings[k]])) as EditableSettings
}

/** What the screens show: the saved settings with the draft on top. */
export function withDraft(settings: ShiftSettings, draft: DraftState): ShiftSettings {
  return { ...settings, ...draft.settings }
}

/** The roster with each person's draft flags on top. */
export function rosterWithDraft(roster: ScheduleStaffRow[], draft: DraftState): ScheduleStaffRow[] {
  return roster.map((row) => (draft.members[row.staffId] ? { ...row, ...draft.members[row.staffId] } : row))
}

/** Names are trimmed before they are compared or sent, the way the server will keep them. */
function normalized(settings: Partial<EditableSettings>): Partial<EditableSettings> {
  const out = { ...settings }
  if (out.roles) out.roles = out.roles.map((r) => ({ ...r, name: r.name.trim() }))
  if (out.stations) out.stations = out.stations.map((s) => ({ ...s, name: s.name.trim() }))
  if (out.presets) out.presets = out.presets.map((p) => ({ ...p, name: p.name.trim() }))
  return out
}

/** Drops every part of the draft that has become identical to what is saved (a wheel turned back to where it was). */
export function pruneDraft(remote: Remote, draft: DraftState): DraftState {
  const settings: Partial<EditableSettings> = {}
  let settingsChanged = false
  for (const key of SETTINGS_KEYS) {
    if (!(key in draft.settings)) continue
    if (deepEqual(normalized({ [key]: draft.settings[key] })[key], remote.settings[key])) settingsChanged = true
    else (settings as Record<string, unknown>)[key] = draft.settings[key]
  }
  const members: Record<string, MemberPatch> = {}
  let membersChanged = false
  for (const [staffId, patch] of Object.entries(draft.members)) {
    const row = remote.roster.find((r) => r.staffId === staffId)
    const kept: MemberPatch = {}
    for (const k of MEMBER_KEYS) {
      if (!(k in patch)) continue
      if (row && deepEqual(patch[k], row[k])) membersChanged = true
      else (kept as Record<string, unknown>)[k] = patch[k]
    }
    if (Object.keys(kept).length) members[staffId] = kept
    else if (Object.keys(patch).length) membersChanged = true
  }
  return settingsChanged || membersChanged ? { settings, members } : draft
}

export type DraftChanges = {
  settings: Partial<EditableSettings>
  members: { staffId: string; patch: MemberPatch }[]
  count: number
  /** Plain-Hebrew list of what changed, for the save bar. */
  labels: string[]
}

const SECTION_LABEL: Record<SettingsKey, string> = {
  workingDays: 'שעות פעילות',
  openTime: 'שעות פעילות',
  closeTime: 'שעות פעילות',
  dayHours: 'שעות פעילות',
  roles: 'תפקידים',
  stations: 'עמדות',
  presets: 'תבניות משמרת',
  safety: 'כללי בטיחות',
  features: 'יכולות',
  scheduleManagers: 'אחראי/ות שיבוץ',
}

export function draftChanges(remote: Remote, draft: DraftState): DraftChanges {
  const pruned = pruneDraft(remote, draft)
  const settings = normalized(pruned.settings)
  const members = Object.entries(pruned.members).map(([staffId, patch]) => ({ staffId, patch }))
  const labels = [...new Set(Object.keys(settings).map((k) => SECTION_LABEL[k as SettingsKey]))]
  if (members.length) labels.push(members.length === 1 ? 'עובד/ת אחד/ת' : `${members.length} עובדים`)
  return { settings, members, count: Object.keys(settings).length + members.length, labels }
}

/** The first thing wrong with the settings as drafted, in words that say what to fix — or null. */
export function validateSettings(s: EditableSettings): string | null {
  for (const [what, list] of [['תפקידים', s.roles], ['עמדות', s.stations], ['תבניות משמרת', s.presets]] as const) {
    if (list.some((item) => !item.name.trim())) return `ב${what} יש שורה בלי שם. מלאו שם או מחקו אותה.`
    if (list.some((item) => item.name.trim().length > 40)) return `ב${what} יש שם ארוך מדי (עד 40 תווים).`
  }
  for (const p of s.presets) {
    if (!HM_PATTERN.test(p.startTime) || !HM_PATTERN.test(p.endTime)) return `לתבנית "${p.name.trim()}" יש שעה לא תקינה.`
    if (p.startTime === p.endTime) return `בתבנית "${p.name.trim()}" שעת ההתחלה והסיום זהות.`
  }
  for (const [day, h] of Object.entries(s.dayHours)) {
    if (!HM_PATTERN.test(h.open) || !HM_PATTERN.test(h.close)) return `לשעות הפעילות ביום ${weekdayLabel(Number(day))} יש שעה לא תקינה.`
  }
  if (!HM_PATTERN.test(s.openTime) || !HM_PATTERN.test(s.closeTime)) return 'שעות הפעילות לא תקינות.'
  for (const key of Object.keys(SAFETY_BOUNDS) as (keyof typeof SAFETY_BOUNDS)[]) {
    const v = s.safety[key]
    if (typeof v !== 'number' || v < SAFETY_BOUNDS[key].min || v > SAFETY_BOUNDS[key].max) return 'אחד מכללי הבטיחות מחוץ לטווח המותר.'
  }
  return null
}
