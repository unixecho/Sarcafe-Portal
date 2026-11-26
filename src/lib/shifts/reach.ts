// "Will this person actually hear about the schedule?" — pure, shared by the manager's board, the guided day
// sheet and the owner's notification ("2 people on the schedule will not get alerts").
//
//   no_app   never signed in to the app (no linked login): they cannot see the schedule or any alert;
//   no_push  signed in, but no device has notifications switched on: they see the schedule only if they open the app;
//   ok       at least one device gets the alerts;
//   unknown  the viewer is not a manager (the roster does not carry it for them).
//
// The owner's answer to both is the same: send the schedule on WhatsApp (the share button) and ask them to
// open the app and turn notifications on.

import type { ScheduleStaffRow } from './types'

export type Reach = 'ok' | 'no_app' | 'no_push' | 'unknown'

export function reachOf(row: Pick<ScheduleStaffRow, 'hasLogin' | 'hasPush'> | undefined | null): Reach {
  if (!row) return 'unknown'
  if (!row.hasLogin) return 'no_app'
  if (row.hasPush === null || row.hasPush === undefined) return 'unknown'
  return row.hasPush ? 'ok' : 'no_push'
}

/** The words on a person's chip. */
export const REACH_TEXT: Record<'no_app' | 'no_push', string> = {
  no_app: 'לא נכנס/ה לאפליקציה',
  no_push: 'ההתראות כבויות',
}

export const reachText = (reach: Reach): string | undefined => (reach === 'no_app' || reach === 'no_push' ? REACH_TEXT[reach] : undefined)

export type Unreachable = { staffId: string; name: string; reach: 'no_app' | 'no_push' }

/** Everyone on these assignments who will not get alerts, once each, in name order. */
export function unreachableAmong(
  roster: Array<Pick<ScheduleStaffRow, 'staffId' | 'displayName' | 'hasLogin' | 'hasPush' | 'active'>>,
  staffIds: Array<string | null>
): Unreachable[] {
  const seen = new Set<string>()
  const out: Unreachable[] = []
  for (const id of staffIds) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    const row = roster.find((r) => r.staffId === id)
    if (!row || !row.active) continue
    const reach = reachOf(row)
    if (reach === 'no_app' || reach === 'no_push') out.push({ staffId: id, name: row.displayName, reach })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'he'))
}

/** The owner's notification: one line per person, then what to do. */
export function unreachableNotice(people: Unreachable[]): { title: string; body: string } {
  const n = people.length
  const title = n === 1 ? `${people[0]!.name} בסידור העבודה ולא יקבל/ת הודעות` : `${n} עובדים בסידור העבודה לא יקבלו הודעות`
  const lines = people.map((p) => `${p.name}: ${REACH_TEXT[p.reach]}`)
  return {
    title,
    body: `${lines.join(' · ')}. שלחו להם את הסידור בוואטסאפ (כפתור "שיתוף" בסידור) ובקשו מהם להיכנס לאפליקציה ולהפעיל התראות.`,
  }
}

/** A stable key for "this exact set of people, for this week": the notification is written once per change. */
export function unreachableKey(weekStart: string, people: Unreachable[]): string {
  return `unreachable:${weekStart}:${people.map((p) => `${p.staffId.slice(0, 8)}${p.reach === 'no_app' ? 'a' : 'p'}`).join('.')}`.slice(0, 200)
}
