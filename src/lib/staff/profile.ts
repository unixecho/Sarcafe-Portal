// A person's own details — name, phone and avatar emoji (2026-10-16). PURE: no React, no Supabase.
// scripts/check-onboarding-wizard.mjs runs this file.
//
// The "my details" step of the onboarding wizard lets a new employee correct their name, add a phone number and choose
// their avatar emoji (the mark they have on the schedule). Colour is NOT chosen here: the scheduler gives every person
// a colour from the roster, so the same person looks the same on the board, the tracker and the shift card.
//
// WHERE THINGS LIVE (no new column): names -> `staff.first_name` / `staff.last_name`; phone -> `staff.phone` (migration 024,
// free text up to 32 characters; this file keeps what is saved to a clean local form); emoji -> `staff.avatar_emoji`.

import { STAFF_AVATARS } from './avatar'

/** Israeli local `0XXXXXXXX(X)`, or `+` and 8-15 digits. */
export const PHONE_RE = /^(0[0-9]{8,9}|\+[0-9]{8,15})$/

/** What a person types ("050-123 4567", "+972 50 123 4567", "(050)1234567") -> the stored form, or null when it is not a
 *  phone number. `+972...` for an Israeli number is stored as local `0...`. */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s\-().]/g, '')
  if (!s) return null
  let t = s
  if (t.startsWith('00')) t = `+${t.slice(2)}`
  if (/^\+972[0-9]{8,9}$/.test(t)) t = `0${t.slice(4)}`
  return PHONE_RE.test(t) ? t : null
}

export const NAME_MAX = 40

export interface ProfileInput {
  firstName?: unknown
  lastName?: unknown
  /** undefined = leave the stored phone alone; null or empty text = clear it */
  phone?: unknown
  emoji?: unknown
}

export interface ProfileValue {
  first_name: string
  last_name: string | null
  phone?: string | null
  avatar_emoji?: string
}

export type ProfileError = 'first_name' | 'last_name' | 'phone' | 'emoji'

export const PROFILE_MESSAGES: Record<ProfileError, string> = {
  first_name: 'כתבו שם פרטי (עד 40 תווים).',
  last_name: 'שם המשפחה ארוך מדי (עד 40 תווים).',
  phone: 'מספר הטלפון לא נראה תקין. למשל 050-1234567.',
  emoji: 'האימוג׳י שנבחר לא קיים ברשימה.',
}

/** A name from a text box: trimmed, inner whitespace collapsed, control and zero-width characters dropped. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v
    .replace(/[\t\n\r]/g, ' ') // a pasted line break is a space, not nothing
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function validateProfile(input: ProfileInput): { ok: true; value: ProfileValue } | { ok: false; error: ProfileError; message: string } {
  const fail = (error: ProfileError) => ({ ok: false as const, error, message: PROFILE_MESSAGES[error] })
  const first = cleanName(input.firstName)
  if (!first || first.length > NAME_MAX) return fail('first_name')
  const last = cleanName(input.lastName)
  if (last.length > NAME_MAX) return fail('last_name')
  const value: ProfileValue = { first_name: first, last_name: last || null }
  if (input.phone !== undefined) {
    if (input.phone === null || (typeof input.phone === 'string' && !input.phone.trim())) value.phone = null
    else {
      const p = typeof input.phone === 'string' ? normalizePhone(input.phone) : null
      if (!p) return fail('phone')
      value.phone = p
    }
  }
  if (input.emoji !== undefined) {
    if (typeof input.emoji !== 'string' || !(STAFF_AVATARS as readonly string[]).includes(input.emoji)) return fail('emoji')
    value.avatar_emoji = input.emoji
  }
  return { ok: true, value }
}

/** The emoji suggested when the person has none yet: the least used among the team, ties by `rand`. */
export function suggestEmoji(used: readonly (string | null | undefined)[], rand: () => number = Math.random): string {
  const count = new Map<string, number>(STAFF_AVATARS.map((e) => [e, 0]))
  for (const e of used) if (e && count.has(e)) count.set(e, (count.get(e) ?? 0) + 1)
  const min = Math.min(...count.values())
  const pool = STAFF_AVATARS.filter((e) => count.get(e) === min)
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))]!
}
