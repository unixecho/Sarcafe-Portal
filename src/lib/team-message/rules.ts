// The team message's pure rules (docs/SARCAFE_TEAM_MESSAGE.md). No React, no Supabase: the route, the card and
// scripts/check-team-message.mjs all read these.

export const TEAM_MESSAGE_KIND = 'staff.message'
export const MAX_TEXT = 280
/** How far ahead the shift picker looks, counting today. */
export const PLAN_DAYS = 7
/** A message may target a shift from yesterday (a late note about it) up to two weeks ahead, never older. */
export const SHIFT_PAST_DAYS = 1
export const SHIFT_FUTURE_DAYS = 14
/** Per sender: a burst and a day. Per branch: a day. The limiter fails CLOSED (a message reaches many phones). */
export const LIMITS = { burst: { max: 6, seconds: 600 }, day: { max: 40, seconds: 86_400 }, branchDay: { max: 80, seconds: 86_400 } } as const

export type Audience = 'all' | 'shift' | 'one'

// Control characters, zero-width joiners used to hide text, and the direction overrides that can make a message read differently
// from what it says (U+202A-202E, U+2066-2069). Newlines become spaces: a push notification is one line.
const STRIP = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g

/** The text as it will be stored and pushed, or null when nothing is left. Never longer than MAX_TEXT. */
export function cleanMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.replace(STRIP, '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (!text) return null
  return text.length > MAX_TEXT ? null : text
}

export function messageTitle(senderFirstName: string | null | undefined): string {
  const name = (senderFirstName ?? '').replace(STRIP, '').trim().slice(0, 30)
  return name ? `הודעה מ${name}` : 'הודעה מההנהלה'
}

const DAY_MS = 86_400_000
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (iso: string, days: number) => isoDay(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS)
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS)

/** "היום" / "מחר" / the weekday, and "9/11". */
export function dayLabel(date: string, today: string): { label: string; dm: string } {
  const diff = dayDiff(date, today)
  const d = new Date(`${date}T00:00:00Z`)
  const weekday = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', weekday: 'long' }).format(d)
  return { label: diff === 0 ? 'היום' : diff === 1 ? 'מחר' : diff === -1 ? 'אתמול' : weekday, dm: `${d.getUTCDate()}/${d.getUTCMonth() + 1}` }
}

/** May a message target a shift on `date`, judged on the branch's own calendar? */
export function shiftDateAllowed(date: string, today: string): boolean {
  const diff = dayDiff(date, today)
  return diff >= -SHIFT_PAST_DAYS && diff <= SHIFT_FUTURE_DAYS
}

/** Who is in "everyone at the branch": active staff of that branch or of every branch (branch_id null), unless switched off there. */
export function inBranchTeam(person: { branch_id: string | null; active: boolean }, branchId: string, switchedOff: Set<string>, id: string): boolean {
  return person.active && (person.branch_id === null || person.branch_id === branchId) && !switchedOff.has(id)
}

/** The line under the composer that says exactly who receives it. */
export function summaryLine(input: { audience: Audience; branchName: string; reachable: number; total: number; shiftName?: string; names?: string[]; person?: string }): string {
  const list = (names: string[]) => { try { return new Intl.ListFormat('he', { style: 'long', type: 'conjunction' }).format(names) } catch { return names.join(', ') } }
  const missing = input.total - input.reachable
  const tail = missing > 0 ? ` (${missing === 1 ? 'אחד לא הפעיל/ה התראות' : `${missing} לא הפעילו התראות`}, לא יקבלו)` : ''
  if (input.audience === 'one') return input.reachable ? `יישלח רק ל־${input.person}${input.shiftName ? `, ${input.shiftName}` : ''}` : `${input.person} לא הפעיל/ה התראות, אי אפשר לשלוח לו/ה`
  if (input.reachable === 0) return input.total === 0 ? 'אין למי לשלוח' : 'אף אחד מהם לא הפעיל התראות, אי אפשר לשלוח'
  const who = input.reachable === 1 ? 'לעובד אחד' : `ל־${input.reachable} עובדים`
  if (input.audience === 'all') return `יישלח ${who} ב${input.branchName}${tail}`
  return `יישלח ${who} ב${input.shiftName}${input.names?.length ? `: ${list(input.names)}` : ''}${tail}`
}
