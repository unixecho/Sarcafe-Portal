// The pure rules behind staff push: when a reminder falls due and where tapping an alert goes.
// No server-only imports on purpose, so scripts/check-staff-push.mjs runs the real code.

import type { WallClock } from '@/lib/shifts/types'

/** An upcoming-shift alert goes out once the shift is this close. */
export const SHIFT_SOON_MINUTES = 60
/** Opening checklists are due this long after the shift starts; handover/closing this long after it ends. */
export const OPENING_GRACE_MINUTES = 60
export const END_GRACE_MINUTES = 10
/** The owners hear about a missing checklist this long after it became due. */
export const OWNER_ESCALATION_MINUTES = 40
/** After this long it is history, not a reminder. */
export const REMINDER_WINDOW_MINUTES = 6 * 60

const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const absMinutes = (date: string, minutes: number) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 60000) + minutes

/** Minutes since the checklist became due (negative = not due yet). Handover/closing fall due after the
 *  shift ends — a shift that runs past midnight ends the next day — opening shortly after it starts. */
export function minutesPastDue(
  assignment: { kind: string; date: string; startTime: string; endTime: string },
  now: WallClock
): number {
  const start = minutesOf(assignment.startTime)
  const end = minutesOf(assignment.endTime)
  const startAbs = absMinutes(assignment.date, start)
  const nowAbs = absMinutes(now.date, minutesOf(now.time))
  if (assignment.kind === 'opening') return nowAbs - (startAbs + OPENING_GRACE_MINUTES)
  const endAbs = startAbs + (end > start ? end - start : 24 * 60 - start + end)
  return nowAbs - (endAbs + END_GRACE_MINUTES)
}

/** Where tapping the alert goes. A link.url the app wrote itself wins (only a plain same-origin path
 *  is honoured, so a stored value can never become an open redirect); otherwise the kind decides. */
export function pushPathFor(kind: string, link: Record<string, unknown> | null): string {
  const url = link?.url
  if (typeof url === 'string' && /^\/(?!\/)[A-Za-z0-9/_\-?=&%.]*$/.test(url)) return url
  if (kind.startsWith('checklist.')) return '/staff/checklists'
  return '/staff/schedule'
}
