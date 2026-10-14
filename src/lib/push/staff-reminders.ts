import 'server-only'

// The notifications nothing "happens" to trigger: tomorrow's and today's shifts, a checklist that is
// about to start or is overdue, the weekly "requests for the week" window. A scheduled run
// (api/cron/staff-push) writes them into the same inbox the rest of the scheduling system uses, so
// the in-app list and the phone push stay one story.
//
// Each reminder carries a dedupe_key and goes in with ignoreDuplicates, so running this every
// minute or every five, twice in a row or from two places, still produces each one exactly once.
// Rows are written directly (not through sched_notify) on purpose: sched_notify only reaches
// people with a Google-linked account, but employees who sign in with number + code are the main
// users of checklists and deserve the same nudge.
//
// What goes out, and when (all branch-local time; the pure timing lives in staff-rules.ts):
//   shift.eve        19:00 the evening before a shift
//   shift.today      07:00 on the day of a shift
//   checklist.soon   15 minutes before the shift starts, naming the checklists waiting for it
//   checklist.late   the checklist is due (opening / arriving handover: 1 h after the shift starts;
//                    closing / departing handover: 90 min after it ends), not submitted, not dismissed.
//                    Opens that exact checklist (/staff/checklists/<id>)
//   checklist.gap    30 minutes after that, to every owner and developer, if it is STILL open. Opens the owner's
//                    tracker on that row (/owner/checklists/<id>), where it can be dismissed
//   issues.digest    08:00, to every owner and developer, per branch, only when something is missing or not working
//                    (the report at /owner/issues); once per branch per day
//   requests.open    when a schedule is published, and again on Sunday: requests for the week are open
//   requests.closing Monday: they close tomorrow (Tuesday)

import { createServiceRoleClient } from '@/lib/supabase/server'
import { ownerChecklistPath, staffChecklistPath } from '@/lib/checklists/links'
import { loadIssueReport } from '@/lib/checklists/issues-server'
import { wallClockNow } from '@/lib/shifts/time'
import type { WallClock } from '@/lib/shifts/types'
import {
  addIsoDays,
  dueAnchor,
  isPreShift,
  issuesDigestDue,
  minutesPastDue,
  OWNER_ESCALATION_MINUTES,
  REMINDER_WINDOW_MINUTES,
  requestsReminder,
  shiftReminderPhase,
} from './staff-rules'

type Service = ReturnType<typeof createServiceRoleClient>
type Row = Record<string, unknown>
type NewRow = { branch_id: string; staff_id: string; kind: string; title: string; body: string; link: { url: string }; dedupe_key: string }

const KIND_LABEL: Record<string, string> = { opening: 'פתיחה', handover: 'החלפת משמרת', closing: 'סגירה' }
const KIND_ORDER: Record<string, number> = { opening: 0, handover: 1, closing: 2 }
const dayMs = 24 * 60 * 60 * 1000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
/** "13/10" */
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`
const range = (start: string, end: string) => `${start}–${end}`

async function insertReminders(service: Service, rows: NewRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const { data, error } = await service.from('schedule_notifications').upsert(rows, { onConflict: 'staff_id,dedupe_key', ignoreDuplicates: true }).select('id')
  if (error) {
    console.error('staff reminders insert failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}

type BranchClock = { name: string; slug: string; kind: string; clock: WallClock }
async function branchClocks(service: Service): Promise<Map<string, BranchClock>> {
  const { data } = await service.from('branches').select('id, name, slug, kind, timezone')
  return new Map(
    ((data ?? []) as Row[]).map((b) => [
      b.id as string,
      { name: (b.name as { he?: string } | null)?.he ?? '', slug: (b.slug as string | null) ?? '', kind: (b.kind as string | null) ?? 'permanent', clock: wallClockNow((b.timezone as string | null) || 'Asia/Jerusalem') },
    ])
  )
}

/** Shifts that could matter right now: yesterday's checklists can still be overdue, tomorrow's shift is announced tonight. */
async function nearbyShifts(service: Service): Promise<Row[]> {
  const now = Date.now()
  const { data } = await service
    .from('shifts')
    .select('id, week_id, branch_id, shift_date, start_time, end_time')
    .gte('shift_date', isoDay(now - 2 * dayMs))
    .lte('shift_date', isoDay(now + 2 * dayMs))
  return (data ?? []) as Row[]
}

async function publishedWeekIds(service: Service, weekIds: string[]): Promise<Set<string>> {
  if (weekIds.length === 0) return new Set()
  const { data } = await service.from('schedule_weeks').select('id').in('id', [...new Set(weekIds)]).eq('status', 'published')
  return new Set(((data ?? []) as Row[]).map((w) => w.id as string))
}

/** "You work tomorrow" (19:00 the evening before) and "you work today" (07:00) — published shifts only,
 *  the same ones the staff home shows. One alert per person per day, however many shifts they have. */
async function shiftReminders(service: Service, clocks: Map<string, BranchClock>, shifts: Row[]): Promise<number> {
  const due = shifts
    .map((s) => ({ s, phase: shiftReminderPhase({ date: s.shift_date as string, startTime: s.start_time as string, endTime: s.end_time as string }, clocks.get(s.branch_id as string)?.clock ?? { date: '', time: '00:00' }) }))
    .filter((x): x is { s: Row; phase: 'eve' | 'today' } => x.phase !== null && clocks.has(x.s.branch_id as string))
  if (due.length === 0) return 0

  const published = await publishedWeekIds(service, due.map((x) => x.s.week_id as string))
  const live = due.filter((x) => published.has(x.s.week_id as string))
  if (live.length === 0) return 0

  const { data: assignments } = await service.from('shift_assignments').select('shift_id, staff_id').in('shift_id', live.map((x) => x.s.id as string)).not('staff_id', 'is', null)
  const byShift = new Map(live.map((x) => [x.s.id as string, x]))
  const grouped = new Map<string, { staffId: string; branchId: string; phase: 'eve' | 'today'; date: string; lines: string[] }>()
  for (const a of (assignments ?? []) as Row[]) {
    const hit = byShift.get(a.shift_id as string)
    if (!hit) continue
    const date = hit.s.shift_date as string
    const key = `${a.staff_id}|${hit.phase}|${date}`
    const branch = clocks.get(hit.s.branch_id as string)
    const line = `${branch?.name ? `${branch.name} · ` : ''}${range(hit.s.start_time as string, hit.s.end_time as string)}`
    const entry = grouped.get(key) ?? { staffId: a.staff_id as string, branchId: hit.s.branch_id as string, phase: hit.phase, date, lines: [] }
    if (!entry.lines.includes(line)) entry.lines.push(line)
    grouped.set(key, entry)
  }

  const rows: NewRow[] = [...grouped.values()].map((g) => ({
    branch_id: g.branchId,
    staff_id: g.staffId,
    kind: g.phase === 'eve' ? 'shift.eve' : 'shift.today',
    title: g.phase === 'eve' ? 'מחר יש לך משמרת' : 'היום יש לך משמרת',
    body: g.lines.join('\n'),
    link: { url: '/staff/schedule' },
    dedupe_key: `shift-${g.phase}:${g.date}`,
  }))
  return insertReminders(service, rows)
}

type Assignment = { id: string; branchId: string; shiftId: string; staffId: string; kind: string; open: boolean }

/** Checklists: a heads-up before the shift, a nudge when one is due and not submitted, and the same
 *  moment a note to the owners and developers. */
async function checklistReminders(service: Service, clocks: Map<string, BranchClock>, shifts: Row[]): Promise<{ soon: number; staff: number; owners: number }> {
  const none = { soon: 0, staff: 0, owners: 0 }
  if (shifts.length === 0) return none
  // Keyed by the SHIFT's date, never by when the checklist row was created: the rows are made when the
  // week is generated, days ahead, so a window on the row's creation time silently dropped every checklist after day three.
  const { data } = await service
    .from('checklist_assignments')
    .select('id, branch_id, shift_id, staff_id, checklist_kind, status, manager_resolved_at')
    .in('shift_id', shifts.map((s) => s.id as string))
    .not('staff_id', 'is', null)
    .limit(1000)
  const all: Assignment[] = ((data ?? []) as Row[]).map((a) => ({
    id: a.id as string,
    branchId: a.branch_id as string,
    shiftId: a.shift_id as string,
    staffId: a.staff_id as string,
    kind: a.checklist_kind as string,
    // Unsent AND not dismissed by an owner: a dismissed checklist is no longer asked for (see isDismissed in window.ts).
    open: (a.status === 'pending' || a.status === 'in_progress') && !a.manager_resolved_at,
  }))
  if (all.length === 0) return none

  const shiftById = new Map(shifts.map((s) => [s.id as string, s]))
  const shiftHasOpening = new Set(all.filter((a) => a.kind === 'opening').map((a) => a.shiftId))
  const branchOf = (id: string) => clocks.get(id)
  const suffix = (branchId: string) => (branchOf(branchId)?.name ? ` · ${branchOf(branchId)!.name}` : '')
  const open = all.filter((a) => a.open)

  // 1) Heads-up, 15 minutes before the shift: one alert per person per shift naming what is waiting.
  const waiting = new Map<string, { branchId: string; staffId: string; shiftId: string; start: string; first: Assignment; kinds: string[] }>()
  for (const a of open) {
    const shift = shiftById.get(a.shiftId)
    const clock = branchOf(a.branchId)?.clock
    if (!shift || !clock) continue
    if (!isPreShift({ date: shift.shift_date as string, startTime: shift.start_time as string }, clock)) continue
    // Only what opens when the shift starts: closing (and a departing handover) opens half an hour before the END,
    // so naming it in a heads-up at 12:45 for an 18:30 form would send the person looking for something locked.
    if (dueAnchor(a.kind, shiftHasOpening.has(a.shiftId)) !== 'start') continue
    const key = `${a.shiftId}|${a.staffId}`
    const entry = waiting.get(key) ?? { branchId: a.branchId, staffId: a.staffId, shiftId: a.shiftId, start: shift.start_time as string, first: a, kinds: [] }
    // The alert opens the first checklist of the shift (opening, then handover, then closing).
    if ((KIND_ORDER[a.kind] ?? 9) < (KIND_ORDER[entry.first.kind] ?? 9)) entry.first = a
    entry.kinds.push(KIND_LABEL[a.kind] ?? 'צ׳קליסט')
    waiting.set(key, entry)
  }
  const soonRows: NewRow[] = [...waiting.values()].map((w) => ({
    branch_id: w.branchId,
    staff_id: w.staffId,
    kind: 'checklist.soon',
    title: 'המשמרת מתחילה בעוד כרבע שעה',
    body: `מחכה לך צ׳קליסט: ${w.kinds.join(' + ')}${suffix(w.branchId)} · ${w.start}`,
    link: { url: staffChecklistPath(w.first.id) },
    dedupe_key: `checklist-soon:${w.shiftId}`,
  }))
  const soon = await insertReminders(service, soonRows)

  // 2) Due and not submitted.
  const due: (Assignment & { late: number })[] = []
  for (const a of open) {
    const shift = shiftById.get(a.shiftId)
    const clock = branchOf(a.branchId)?.clock
    if (!shift || !clock) continue
    const late = minutesPastDue(
      { kind: a.kind, date: shift.shift_date as string, startTime: shift.start_time as string, endTime: shift.end_time as string, shiftHasOpening: shiftHasOpening.has(a.shiftId) },
      clock
    )
    if (late >= 0 && late <= REMINDER_WINDOW_MINUTES) due.push({ ...a, late })
  }
  if (due.length === 0) return { ...none, soon }

  const staff = await insertReminders(
    service,
    due.map((d) => ({
      branch_id: d.branchId,
      staff_id: d.staffId,
      kind: 'checklist.late',
      title: 'הצ׳קליסט עוד לא הוגש',
      body: `${KIND_LABEL[d.kind] ?? 'צ׳קליסט'}${suffix(d.branchId)}. אפשר להגיש עכשיו.`,
      link: { url: staffChecklistPath(d.id) },
      dedupe_key: `checklist-late:${d.id}`,
    }))
  )

  // 3) Owners and developers. The employee is NOT excluded when they are one of them: an owner who works a
  //    shift and leaves a checklist open hears about it twice, as an employee and as an owner (that is how a
  //    developer tests the whole chain on themselves). /owner/checklists is an owner page, so a delegate
  //    without the owner role would not be able to open the link.
  const escalate = due.filter((d) => d.late >= OWNER_ESCALATION_MINUTES)
  let owners = 0
  if (escalate.length > 0) {
    const [{ data: ownerRows }, { data: people }] = await Promise.all([
      service.from('staff').select('id').eq('active', true).or('role.eq.owner,badge.eq.owner,badge.eq.developer'),
      service.from('staff').select('id, first_name, display_name').in('id', [...new Set(escalate.map((d) => d.staffId))]),
    ])
    const nameOf = new Map(((people ?? []) as Row[]).map((p) => [p.id as string, (p.first_name as string | null) || (p.display_name as string | null) || 'עובד/ת']))
    // One alert per CHECKLIST (a shift and a kind), not per person: when nobody was picked and two people share the
    // shift, both still hold an unsent copy of the same form, and "Dana didn't send it" + "Eli didn't send it" is one
    // problem told twice. The people are named together; the alert opens the first copy (smallest id, so the dedupe key
    // of a single person is what it always was and nothing already announced is announced again).
    const groups = new Map<string, typeof escalate>()
    for (const d of escalate) groups.set(`${d.shiftId}|${d.kind}`, [...(groups.get(`${d.shiftId}|${d.kind}`) ?? []), d])
    const rows: NewRow[] = []
    for (const owner of (ownerRows ?? []) as Row[]) {
      for (const group of groups.values()) {
        const first = [...group].sort((a, b) => a.id.localeCompare(b.id))[0]!
        const names = [...new Set(group.map((d) => nameOf.get(d.staffId) ?? 'עובד/ת'))]
        rows.push({
          branch_id: first.branchId,
          staff_id: owner.id as string,
          kind: 'checklist.gap',
          title: 'צ׳קליסט לא הוגש',
          body: `${names.join(' · ')} · ${KIND_LABEL[first.kind] ?? 'צ׳קליסט'}${suffix(first.branchId)}`,
          link: { url: ownerChecklistPath(first.id) },
          dedupe_key: `checklist-gap:${first.id}`,
        })
      }
    }
    owners = await insertReminders(service, rows)
  }
  return { soon, staff, owners }
}

// ---- The owners' morning report ---------------------------------------------------------------------

/** A branch with nothing open is looked at again soon, not on every two-minute run of the window. Best effort per instance. */
const digestChecked = new Map<string, number>()
const DIGEST_RECHECK_MS = 10 * 60 * 1000

/** "What is missing or not working": one alert per owner per branch per day, in the morning, only when something is
 *  open (see issues.ts for what counts). It lists the worst few and opens the full report. Never throws. */
async function issuesDigest(service: Service, clocks: Map<string, BranchClock>): Promise<number> {
  const due = [...clocks].filter(([, branch]) => branch.kind === 'permanent' && issuesDigestDue(branch.clock))
  if (due.length === 0) return 0
  const { data: ownerRows } = await service.from('staff').select('id').eq('active', true).or('role.eq.owner,badge.eq.owner,badge.eq.developer')
  const owners = ((ownerRows ?? []) as Row[]).map((o) => o.id as string)
  if (owners.length === 0) return 0
  let written = 0
  for (const [branchId, branch] of due) {
    const key = `issues-digest:${branchId}:${branch.clock.date}`
    const seen = digestChecked.get(key)
    if (seen !== undefined && Date.now() - seen < DIGEST_RECHECK_MS) continue
    const { data: done } = await service.from('schedule_notifications').select('id').eq('dedupe_key', key).limit(1)
    if ((done ?? []).length > 0) continue
    digestChecked.set(key, Date.now())
    const report = await loadIssueReport(service, branchId)
    if (report.open.length === 0) continue
    const lines = report.open.slice(0, 4).map((g) => `${g.label} · דווח ${g.reports.length === 1 ? 'פעם אחת' : `${g.reports.length} פעמים`}${g.people > 1 ? ` · ${g.people} עובדים` : ''}`)
    const rest = report.open.length - lines.length
    const count = report.open.length
    written += await insertReminders(
      service,
      owners.map((staffId) => ({
        branch_id: branchId,
        staff_id: staffId,
        kind: 'issues.digest',
        title: count === 1 ? 'דוח בוקר: דבר אחד לטיפול' : `דוח בוקר: ${count} דברים לטיפול`,
        body: `${branch.name ? `${branch.name}\n` : ''}${lines.join('\n')}${rest > 0 ? `\nועוד ${rest}` : ''}`,
        link: { url: `/owner/issues${branch.slug ? `?branch=${branch.slug}` : ''}` },
        dedupe_key: key,
      }))
    )
  }
  return written
}

// ---- "Requests for the week" ---------------------------------------------------------------------

/** Active, Google-linked employees who can be scheduled in the branch (only they can open the requests tab). */
async function requestRecipients(service: Service, branchId: string, targetWeek: string, skipSubmitted: boolean): Promise<string[]> {
  const { data: settings } = await service.from('shift_settings').select('features').eq('branch_id', branchId).maybeSingle()
  if ((settings?.features as { availability?: boolean } | null)?.availability === false) return []
  const { data: members } = await service.from('schedule_members').select('staff_id').eq('branch_id', branchId).eq('schedulable', true)
  const memberIds = ((members ?? []) as Row[]).map((m) => m.staff_id as string)
  if (memberIds.length === 0) return []
  const { data: people } = await service.from('staff').select('id').in('id', memberIds).eq('active', true).not('auth_user_id', 'is', null)
  let ids = ((people ?? []) as Row[]).map((p) => p.id as string)
  if (skipSubmitted && ids.length > 0) {
    const { data: submitted } = await service.from('shift_availability').select('staff_id').eq('branch_id', branchId).eq('week_start', targetWeek).eq('status', 'submitted')
    const done = new Set(((submitted ?? []) as Row[]).map((s) => s.staff_id as string))
    ids = ids.filter((id) => !done.has(id))
  }
  return ids
}

const weekRange = (targetWeek: string) => `${dayMonth(targetWeek)}–${dayMonth(addIsoDays(targetWeek, 6))}`

/** The weekly reminders, written by the scheduled run: Sunday "requests are open", Monday "they close tomorrow".
 *  Whoever already submitted for that week is left alone. */
async function requestReminders(service: Service, clocks: Map<string, BranchClock>): Promise<number> {
  let written = 0
  for (const [branchId, branch] of clocks) {
    if (branch.kind !== 'permanent') continue
    const reminder = requestsReminder(branch.clock)
    if (!reminder) continue
    const recipients = await requestRecipients(service, branchId, reminder.targetWeek, true)
    const closing = reminder.phase === 'closing'
    written += await insertReminders(
      service,
      recipients.map((staffId) => ({
        branch_id: branchId,
        staff_id: staffId,
        kind: closing ? 'requests.closing' : 'requests.open',
        title: closing ? 'מחר נסגרות הבקשות לשבוע' : 'בקשות לשבוע — אפשר להגיש',
        body: closing
          ? `מחר, יום שלישי ${dayMonth(reminder.closeDate)}, נסגרת ההגשה לשבוע ${weekRange(reminder.targetWeek)}.`
          : `שבוע ${weekRange(reminder.targetWeek)}. אפשר להגיש בקשות וזמינות עד יום שלישי ${dayMonth(reminder.closeDate)}.`,
        link: { url: '/staff/schedule' },
        dedupe_key: `requests-${closing ? 'closing' : 'sunday'}:${reminder.targetWeek}`,
      }))
    )
  }
  return written
}

/** Called right after a manager publishes a week: tell every schedulable employee of the branch that the
 *  requests for the week AFTER it are open (they close the Tuesday of the published week). Once per person per
 *  target week, however many times the schedule is re-published. Never throws. */
export async function announceRequestsOpen(weekId: string, service: Service = createServiceRoleClient()): Promise<number> {
  try {
    const { data: week } = await service.from('schedule_weeks').select('branch_id, week_start, status').eq('id', weekId).maybeSingle()
    if (!week || week.status !== 'published') return 0
    const branchId = week.branch_id as string
    const clocks = await branchClocks(service)
    const branch = clocks.get(branchId)
    if (!branch || branch.kind !== 'permanent') return 0
    const targetWeek = addIsoDays(week.week_start as string, 7)
    const closeDate = addIsoDays(targetWeek, -5)
    if (closeDate < branch.clock.date) return 0 // already closed: nothing to ask for
    const recipients = await requestRecipients(service, branchId, targetWeek, false)
    return insertReminders(
      service,
      recipients.map((staffId) => ({
        branch_id: branchId,
        staff_id: staffId,
        kind: 'requests.open',
        title: 'בקשות לשבוע — אפשר להגיש',
        body: `הסידור פורסם. אפשר להגיש בקשות וזמינות לשבוע ${weekRange(targetWeek)} עד יום שלישי ${dayMonth(closeDate)}.`,
        link: { url: '/staff/schedule' },
        dedupe_key: `requests-open:${targetWeek}`,
      }))
    )
  } catch (err) {
    console.error('announceRequestsOpen failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

export type ReminderCounts = { shifts: number; checklistSoon: number; checklistStaff: number; checklistOwners: number; requests: number; issues: number }

export async function createStaffReminders(service: Service = createServiceRoleClient()): Promise<ReminderCounts> {
  const clocks = await branchClocks(service)
  const shifts = await nearbyShifts(service)
  const failed = <T,>(what: string, fallback: T) => (err: unknown) => (console.error(`${what} reminders failed:`, err instanceof Error ? err.message : err), fallback)
  const [shiftCount, checklist, requests, issues] = await Promise.all([
    shiftReminders(service, clocks, shifts).catch(failed('shift', 0)),
    checklistReminders(service, clocks, shifts).catch(failed('checklist', { soon: 0, staff: 0, owners: 0 })),
    requestReminders(service, clocks).catch(failed('request', 0)),
    issuesDigest(service, clocks).catch(failed('issues digest', 0)),
  ])
  return { shifts: shiftCount, checklistSoon: checklist.soon, checklistStaff: checklist.staff, checklistOwners: checklist.owners, requests, issues }
}
