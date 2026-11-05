import 'server-only'

import { ApiError, Forbidden, NotFound, RateLimited } from '@/lib/http/errors'
import { requireAnyMenuEditor, type StaffRow } from '@/lib/owner/guard'
import { canEditMenu } from '@/lib/staff/access'
import { wallClockNow } from '@/lib/shifts/time'
import type { createServiceRoleClient } from '@/lib/supabase/server'
import { SLUG_PATTERN } from '@/lib/branches'
import { isMissingObject } from '@/lib/tools/usage-server'
import { addDays, dayLabel, inBranchTeam, LIMITS, messageTitle, PLAN_DAYS, shiftDateAllowed, TEAM_MESSAGE_KIND, type Audience } from './rules'

// The team message (owner, 2026-11-05): an owner or a branch's general manager sends a short note to everyone at the branch, to one
// shift, or to one person on that shift. Design and threat model: docs/SARCAFE_TEAM_MESSAGE.md. The load-bearing rules:
//   - who may send is decided here, on the server, for THIS branch (requireAnyMenuEditor first, then canEditMenu for the branch: owner anywhere, a general manager only their own);
//   - who receives it is resolved here from the published schedule and the staff table: the browser only names a branch, a shift and
//     an assignment, and each is checked to belong to the one before it;
//   - only people with at least one registered notification device receive it (owner: "only workers who enabled notifications");
//   - nothing comes back that the sender could not already see on the schedule: first names and counts, never ids, phones or e-mails.

type Service = ReturnType<typeof createServiceRoleClient>
type BranchRow = { id: string; slug: string; name: { he?: string } | null; timezone: string | null; active: boolean }
type StaffLite = { id: string; first_name: string | null; display_name: string | null; branch_id: string | null; active: boolean }

const unavailable = () => new ApiError(503, 'unavailable', 'לא הצלחנו לטעון את הנתונים כרגע. נסו שוב בעוד רגע.')
const firstName = (s: Pick<StaffLite, 'first_name' | 'display_name'> | undefined, fallback?: string | null) =>
  (s?.first_name || s?.display_name || fallback || 'עובד/ת').trim().split(/\s+/)[0]!.slice(0, 24)

/** The branch by its slug, and the caller allowed to message it. 404 for an unknown or closed branch (same answer either way). */
export async function messengerFor(service: Service, slug: string): Promise<{ me: StaffRow; branch: BranchRow; today: string }> {
  // Who is asking comes first: a signed-out caller or an employee gets the same 401 / 403 for every branch name, real or not.
  const me = await requireAnyMenuEditor()
  if (!SLUG_PATTERN.test(slug)) throw NotFound('הסניף לא נמצא')
  const { data, error } = await service.from('branches').select('id, slug, name, timezone, active').eq('slug', slug).maybeSingle()
  if (error) throw unavailable()
  const branch = data as BranchRow | null
  if (!branch || !branch.active) throw NotFound('הסניף לא נמצא')
  if (!canEditMenu(me, branch.id)) throw Forbidden('Menu-editor access required for this branch.')
  return { me, branch, today: wallClockNow(branch.timezone || 'Asia/Jerusalem').date }
}

/** Active staff in "everyone at the branch" (see rules.inBranchTeam). */
async function branchTeam(service: Service, branchId: string): Promise<StaffLite[]> {
  const [people, members] = await Promise.all([
    service.from('staff').select('id, first_name, display_name, branch_id, active').eq('active', true).or(`branch_id.is.null,branch_id.eq.${branchId}`),
    service.from('schedule_members').select('staff_id, schedulable').eq('branch_id', branchId),
  ])
  if (people.error || members.error) throw unavailable()
  const off = new Set(((members.data ?? []) as { staff_id: string; schedulable: boolean }[]).filter((m) => m.schedulable === false).map((m) => m.staff_id))
  return ((people.data ?? []) as StaffLite[]).filter((p) => inBranchTeam(p, branchId, off, p.id))
}

/** The people (of `ids`) who have at least one phone registered for notifications. */
async function reachableOf(service: Service, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const { data, error } = await service.from('staff_push_subscriptions').select('staff_id').in('staff_id', [...new Set(ids)])
  if (error) throw unavailable()
  return new Set(((data ?? []) as { staff_id: string }[]).map((r) => r.staff_id))
}

type ShiftRow = { id: string; week_id: string; branch_id: string; shift_date: string; start_time: string; end_time: string }
type AssignRow = { id: string; shift_id: string; staff_id: string | null; staff_name: string | null }

async function publishedShifts(service: Service, branchId: string, from: string, to: string): Promise<ShiftRow[]> {
  const { data, error } = await service.from('shifts').select('id, week_id, branch_id, shift_date, start_time, end_time')
    .eq('branch_id', branchId).gte('shift_date', from).lte('shift_date', to).order('shift_date').order('start_time')
  if (error) throw unavailable()
  const shifts = (data ?? []) as ShiftRow[]
  const weekIds = [...new Set(shifts.map((s) => s.week_id))]
  if (!weekIds.length) return []
  const { data: weeks, error: weeksError } = await service.from('schedule_weeks').select('id').in('id', weekIds).eq('status', 'published')
  if (weeksError) throw unavailable()
  const published = new Set(((weeks ?? []) as { id: string }[]).map((w) => w.id))
  return shifts.filter((s) => published.has(s.week_id))
}

async function assignmentsOf(service: Service, shiftIds: string[]): Promise<AssignRow[]> {
  if (!shiftIds.length) return []
  const { data, error } = await service.from('shift_assignments').select('id, shift_id, staff_id, staff_name').in('shift_id', shiftIds).not('staff_id', 'is', null)
  if (error) throw unavailable()
  return (data ?? []) as AssignRow[]
}

async function staffByIds(service: Service, ids: string[]): Promise<Map<string, StaffLite>> {
  if (!ids.length) return new Map()
  const { data, error } = await service.from('staff').select('id, first_name, display_name, branch_id, active').in('id', [...new Set(ids)])
  if (error) throw unavailable()
  return new Map(((data ?? []) as StaffLite[]).map((s) => [s.id, s]))
}

export type PlanPerson = { key: string; name: string; reachable: boolean; self: boolean }
export type PlanShift = { id: string; start: string; end: string; people: PlanPerson[] }
export type PlanDay = { date: string; label: string; dm: string; shifts: PlanShift[] }
export type MessagePlan = { branch: { slug: string; name: string }; today: string; team: { total: number; reachable: number }; days: PlanDay[] }

/** What the composer needs: the branch team's size and reach, and the next days' published shifts with who is on them. */
export async function loadMessagePlan(service: Service, me: StaffRow, branch: BranchRow, today: string): Promise<MessagePlan> {
  const to = addDays(today, PLAN_DAYS - 1)
  const [team, shifts] = await Promise.all([branchTeam(service, branch.id), publishedShifts(service, branch.id, today, to)])
  const assignments = await assignmentsOf(service, shifts.map((s) => s.id))
  const people = await staffByIds(service, assignments.map((a) => a.staff_id!).filter(Boolean))
  const reachable = await reachableOf(service, [...team.map((t) => t.id), ...people.keys()])
  const others = team.filter((t) => t.id !== me.id)
  const days: PlanDay[] = []
  for (let i = 0; i < PLAN_DAYS; i++) {
    const date = addDays(today, i)
    const { label, dm } = dayLabel(date, today)
    const shiftsOfDay = shifts.filter((s) => s.shift_date === date).map((s) => ({
      id: s.id,
      start: s.start_time.slice(0, 5),
      end: s.end_time.slice(0, 5),
      people: assignments
        .filter((a) => a.shift_id === s.id && a.staff_id && people.get(a.staff_id)?.active)
        .map((a) => ({ key: a.id, name: firstName(people.get(a.staff_id!), a.staff_name), reachable: reachable.has(a.staff_id!), self: a.staff_id === me.id }))
        .sort((x, y) => x.name.localeCompare(y.name, 'he')),
    }))
    days.push({ date, label, dm, shifts: shiftsOfDay })
  }
  return { branch: { slug: branch.slug, name: branch.name?.he ?? branch.slug }, today, team: { total: others.length, reachable: others.filter((t) => reachable.has(t.id)).length }, days }
}

/** The limiter: 'ok', 'limited', or 'error' when it could not answer. A team message fails CLOSED on 'error'. */
async function limit(service: Service, key: string, max: number, seconds: number): Promise<'ok' | 'limited' | 'error'> {
  try {
    const { data, error } = await service.rpc('check_rate_limit', { p_key: key, p_max: max, p_window_seconds: seconds })
    if (error) return 'error'
    return data === true ? 'ok' : 'limited'
  } catch { return 'error' }
}

export type SendInput = { audience: 'all' | 'shift'; shiftId?: string; assignmentId?: string; text: string; requestId: string }
export type SendResult = { sent: number; skipped: number; names: string[] }

export async function sendTeamMessage(service: Service, me: StaffRow, branch: BranchRow, today: string, input: SendInput): Promise<SendResult> {
  // 1. limits (per sender burst and day, per branch day). Fail closed.
  for (const [key, rule] of [[`team-msg:${me.id}:burst`, LIMITS.burst], [`team-msg:${me.id}:day`, LIMITS.day], [`team-msg:branch:${branch.id}`, LIMITS.branchDay]] as const) {
    const verdict = await limit(service, key, rule.max, rule.seconds)
    if (verdict === 'limited') throw RateLimited('נשלחו הרבה הודעות בזמן קצר. נסו שוב מאוחר יותר.')
    if (verdict === 'error') throw unavailable()
  }

  // 2. who receives it, resolved here.
  let audience: Audience = input.audience
  let candidates: { id: string; name: string }[] = []
  let shiftId: string | null = null
  if (input.audience === 'all') {
    candidates = (await branchTeam(service, branch.id)).filter((p) => p.id !== me.id).map((p) => ({ id: p.id, name: firstName(p) }))
  } else {
    const { data: shift, error } = await service.from('shifts').select('id, week_id, branch_id, shift_date, start_time, end_time').eq('id', input.shiftId!).maybeSingle()
    if (error) throw unavailable()
    const row = shift as ShiftRow | null
    // Same answer for "no such shift", "another branch's shift" and "a shift too far in the past or future": it is not one you can message.
    if (!row || row.branch_id !== branch.id || !shiftDateAllowed(row.shift_date, today)) throw NotFound('המשמרת לא נמצאה')
    const { data: week, error: weekError } = await service.from('schedule_weeks').select('id').eq('id', row.week_id).eq('status', 'published').maybeSingle()
    if (weekError) throw unavailable()
    if (!week) throw NotFound('המשמרת לא נמצאה')
    shiftId = row.id
    let assignments = await assignmentsOf(service, [row.id])
    if (input.assignmentId) {
      assignments = assignments.filter((a) => a.id === input.assignmentId)
      if (!assignments.length) throw NotFound('העובד/ת לא משובץ/ת במשמרת הזו')
      if (assignments[0]!.staff_id === me.id) throw new ApiError(400, 'bad_request', 'אי אפשר לשלוח הודעה לעצמך')
      audience = 'one'
    }
    const people = await staffByIds(service, assignments.map((a) => a.staff_id!))
    candidates = assignments
      .filter((a) => a.staff_id && a.staff_id !== me.id && people.get(a.staff_id)?.active)
      .map((a) => ({ id: a.staff_id!, name: firstName(people.get(a.staff_id!), a.staff_name) }))
  }
  candidates = [...new Map(candidates.map((c) => [c.id, c])).values()] // one person on two overlapping slots: one message
  const reach = await reachableOf(service, candidates.map((c) => c.id))
  const recipients = candidates.filter((c) => reach.has(c.id))
  const skipped = candidates.length - recipients.length
  if (!recipients.length) {
    throw new ApiError(409, 'no_recipients', candidates.length ? 'אף אחד מהם לא הפעיל התראות, ההודעה לא נשלחה' : 'אין למי לשלוח', { skipped })
  }

  // 3. the audit row doubles as the "send once" lock (its primary key is the request id). Before the migration: a one-shot limiter key.
  const audit = await service.from('staff_messages').insert({ id: input.requestId, branch_id: branch.id, sender_id: me.id, audience, shift_id: shiftId, body: input.text, status: 'sending' })
  let audited = true
  if (audit.error) {
    if (audit.error.code === '23505') throw new ApiError(409, 'duplicate', 'ההודעה הזו כבר נשלחה')
    if (!isMissingObject(audit.error)) throw unavailable()
    audited = false
    const once = await limit(service, `team-msg:req:${input.requestId}`, 1, 86_400)
    if (once === 'limited') throw new ApiError(409, 'duplicate', 'ההודעה הזו כבר נשלחה')
    if (once === 'error') throw unavailable()
  }

  // 4. one insert for everyone: all or nothing. The push outbox (flushStaffPush) delivers them.
  const title = messageTitle(me.first_name ?? me.display_name)
  const rows = recipients.map((r) => ({ branch_id: branch.id, staff_id: r.id, kind: TEAM_MESSAGE_KIND, title, body: input.text, link: { url: '/staff', msg: input.requestId, audience } }))
  const { error: insertError } = await service.from('schedule_notifications').insert(rows)
  if (insertError) {
    if (audited) await service.from('staff_messages').update({ status: 'failed' }).eq('id', input.requestId)
    throw unavailable()
  }
  if (audited) await service.from('staff_messages').update({ status: 'sent', recipients: recipients.length, skipped }).eq('id', input.requestId)
  return { sent: recipients.length, skipped, names: recipients.map((r) => r.name).slice(0, 30) }
}

/** Branches the caller may message, for the composer's own switch when there is no dashboard branch switch above it. */
export async function messageableBranches(service: Service, me: { role?: string | null; badge?: string | null; branch_id?: string | null }): Promise<{ slug: string; name: string }[]> {
  const { data } = await service.from('branches').select('id, slug, name, kind, active').eq('active', true).order('created_at')
  const rows = ((data ?? []) as { id: string; slug: string; name: { he?: string } | null; kind: string | null }[])
  const op = me.role === 'owner' || me.badge === 'owner'
  const gm = me.badge === 'general_manager'
  if (!op && !gm) throw Forbidden()
  return rows.filter((b) => op || !me.branch_id || me.branch_id === b.id).map((b) => ({ slug: b.slug, name: b.name?.he ?? b.slug }))
}
