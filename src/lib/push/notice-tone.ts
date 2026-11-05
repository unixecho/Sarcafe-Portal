// Is an alert good news, bad news or neither? (owner, 2026-11-05: "positive notifications with a bit of green and the negative or
// errors in red"). PURE: no React, no Supabase; the notification menu, the toasts and scripts/check-glass.mjs read it.
//
// The kind decides first (kinds are stable, written by the app and the database functions); the Hebrew title is the fallback for the
// few kinds whose outcome lives only in the text ("timeoff.decided" is "יום החופש אושר" or "בקשת יום החופש נדחתה").

export type Tone = 'ok' | 'bad' | 'neutral'

const OK_KINDS = new Set([
  'schedule.published', 'swap.accepted', 'swap.accept', 'swap.approved', 'swap.approve', 'request.approved', 'request.approve',
  'timeoff.approve', 'availability.submitted', 'dev.club_signup', 'waitlist.new', 'staff.onboard', 'staff.reactivate',
])
const BAD_KINDS = new Set([
  'swap.declined', 'swap.decline', 'swap.rejected', 'swap.reject', 'swap.cancelled', 'swap.cancel', 'request.reject', 'request.cancelled',
  'request.cancel', 'timeoff.decline', 'timeoff.cancelled', 'schedule.unpublish', 'checklist.late', 'checklist.gap', 'issues.digest',
  'dev.kiosk_battery', 'staff.deactivate',
])
const OK_WORDS = /(אושר|אושרה|אושרו|פורסם|פורסמה|התקבל|הושלם|הצליח|נשלח בהצלחה)/
const BAD_WORDS = /(נדח|בוטל|בוטלה|לא הוגש|לא נשלח|נכשל|תקלה|חסר|אזל|באיחור|סוללה חלשה)/

export function noticeTone(kind: string | null | undefined, title?: string | null): Tone {
  const k = (kind ?? '').trim()
  const t = title ?? ''
  if (BAD_KINDS.has(k)) return 'bad'
  if (OK_KINDS.has(k)) return 'ok'
  if (BAD_WORDS.test(t)) return 'bad'
  if (OK_WORDS.test(t)) return 'ok'
  return 'neutral'
}
