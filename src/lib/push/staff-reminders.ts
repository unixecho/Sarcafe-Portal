import 'server-only'

// The notifications nothing "happens" to trigger: a shift about to start, a checklist nobody
// submitted. A scheduled run (api/cron/staff-push) writes them into the same inbox the rest of
// the scheduling system uses, so the in-app list and the phone push stay one story.
//
// Each reminder carries a dedupe_key and goes in with ignoreDuplicates, so running this every
// minute or every five, twice in a row or from two places, still produces each one exactly once.
// Rows are written directly (not through sched_notify) on purpose: sched_notify only reaches
// people with a Google-linked account, but employees who sign in with number + code are the main
// users of checklists and deserve the same nudge.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { minutesUntilStart, wallClockNow } from '@/lib/shifts/time'
import type { WallClock } from '@/lib/shifts/types'
import { minutesPastDue, OWNER_ESCALATION_MINUTES, REMINDER_WINDOW_MINUTES, SHIFT_SOON_MINUTES } from './staff-rules'

type Service = ReturnType<typeof createServiceRoleClient>
type Row = Record<string, unknown>
type NewRow = { branch_id: string; staff_id: string; kind: string; title: string; body: string; link: { url: string }; dedupe_key: string }

const KIND_LABEL: Record<string, string> = { opening: 'פתיחה', handover: 'החלפת משמרת', closing: 'סגירה' }
const dayMs = 24 * 60 * 60 * 1000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

async function insertReminders(service: Service, rows: NewRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const { data, error } = await service.from('schedule_notifications').upsert(rows, { onConflict: 'staff_id,dedupe_key', ignoreDuplicates: true }).select('id')
  if (error) {
    console.error('staff reminders insert failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}

type BranchClock = { name: string; clock: WallClock }
async function branchClocks(service: Service): Promise<Map<string, BranchClock>> {
  const { data } = await service.from('branches').select('id, name, timezone')
  return new Map(
    ((data ?? []) as Row[]).map((b) => [
      b.id as string,
      { name: (b.name as { he?: string } | null)?.he ?? '', clock: wallClockNow((b.timezone as string | null) || 'Asia/Jerusalem') },
    ])
  )
}

/** "Your shift starts in under an hour" — published shifts only, the same ones the staff home shows. */
async function shiftSoonReminders(service: Service, clocks: Map<string, BranchClock>): Promise<number> {
  const today = Date.now()
  const { data: shifts } = await service
    .from('shifts')
    .select('id, week_id, branch_id, shift_date, start_time, end_time')
    .gte('shift_date', isoDay(today - dayMs))
    .lte('shift_date', isoDay(today + dayMs))
  const near = ((shifts ?? []) as Row[]).filter((s) => {
    const clock = clocks.get(s.branch_id as string)?.clock
    if (!clock) return false
    const minutes = minutesUntilStart({ date: s.shift_date as string, startTime: s.start_time as string }, clock)
    return minutes > 0 && minutes <= SHIFT_SOON_MINUTES
  })
  if (near.length === 0) return 0

  const { data: published } = await service.from('schedule_weeks').select('id').in('id', [...new Set(near.map((s) => s.week_id as string))]).eq('status', 'published')
  const publishedIds = new Set(((published ?? []) as Row[]).map((w) => w.id as string))
  const live = near.filter((s) => publishedIds.has(s.week_id as string))
  if (live.length === 0) return 0

  const { data: assignments } = await service.from('shift_assignments').select('id, shift_id, staff_id').in('shift_id', live.map((s) => s.id as string)).not('staff_id', 'is', null)
  const byShift = new Map(live.map((s) => [s.id as string, s]))
  const rows: NewRow[] = []
  for (const a of (assignments ?? []) as Row[]) {
    const shift = byShift.get(a.shift_id as string)
    if (!shift) continue
    const branch = clocks.get(shift.branch_id as string)
    rows.push({
      branch_id: shift.branch_id as string,
      staff_id: a.staff_id as string,
      kind: 'shift.soon',
      title: 'המשמרת שלך מתחילה בקרוב',
      body: `${branch?.name ? `${branch.name} · ` : ''}${shift.start_time}–${shift.end_time}`,
      link: { url: '/staff/schedule' },
      dedupe_key: `shift-soon:${a.id}`,
    })
  }
  return insertReminders(service, rows)
}

/** A checklist that is due and not submitted: first nudge the person, then tell the owners. */
async function checklistReminders(service: Service, clocks: Map<string, BranchClock>): Promise<{ staff: number; owners: number }> {
  const since = new Date(Date.now() - 3 * dayMs).toISOString()
  const { data: open } = await service
    .from('checklist_assignments')
    .select('id, branch_id, shift_id, staff_id, checklist_kind')
    .in('status', ['pending', 'in_progress'])
    .not('staff_id', 'is', null)
    .gte('created_at', since)
    .limit(500)
  const assignments = (open ?? []) as Row[]
  if (assignments.length === 0) return { staff: 0, owners: 0 }

  const { data: shifts } = await service.from('shifts').select('id, shift_date, start_time, end_time').in('id', [...new Set(assignments.map((a) => a.shift_id as string))])
  const shiftById = new Map(((shifts ?? []) as Row[]).map((s) => [s.id as string, s]))

  const due: { id: string; branchId: string; staffId: string; kind: string; late: number }[] = []
  for (const a of assignments) {
    const shift = shiftById.get(a.shift_id as string)
    const clock = clocks.get(a.branch_id as string)?.clock
    if (!shift || !clock) continue
    const late = minutesPastDue(
      { kind: a.checklist_kind as string, date: shift.shift_date as string, startTime: shift.start_time as string, endTime: shift.end_time as string },
      clock
    )
    if (late >= 0 && late <= REMINDER_WINDOW_MINUTES) due.push({ id: a.id as string, branchId: a.branch_id as string, staffId: a.staff_id as string, kind: a.checklist_kind as string, late })
  }
  if (due.length === 0) return { staff: 0, owners: 0 }

  const staffRows: NewRow[] = due.map((d) => ({
    branch_id: d.branchId,
    staff_id: d.staffId,
    kind: 'checklist.late',
    title: 'הצ׳קליסט עוד לא הוגש',
    body: `${KIND_LABEL[d.kind] ?? 'צ׳קליסט'}${clocks.get(d.branchId)?.name ? ` · ${clocks.get(d.branchId)!.name}` : ''}. אפשר להגיש עכשיו.`,
    link: { url: '/staff/checklists' },
    dedupe_key: `checklist-late:${d.id}`,
  }))
  const staff = await insertReminders(service, staffRows)

  // Owners only: /owner/checklists is an owner page, a delegate could not open the link.
  const escalate = due.filter((d) => d.late >= OWNER_ESCALATION_MINUTES)
  let owners = 0
  if (escalate.length > 0) {
    const [{ data: ownerRows }, { data: people }] = await Promise.all([
      service.from('staff').select('id').eq('active', true).or('role.eq.owner,badge.eq.owner'),
      service.from('staff').select('id, first_name, display_name').in('id', [...new Set(escalate.map((d) => d.staffId))]),
    ])
    const nameOf = new Map(((people ?? []) as Row[]).map((p) => [p.id as string, (p.first_name as string | null) || (p.display_name as string | null) || 'עובד/ת']))
    const rows: NewRow[] = []
    for (const owner of (ownerRows ?? []) as Row[]) {
      for (const d of escalate) {
        if (owner.id === d.staffId) continue
        rows.push({
          branch_id: d.branchId,
          staff_id: owner.id as string,
          kind: 'checklist.gap',
          title: 'צ׳קליסט לא הוגש',
          body: `${nameOf.get(d.staffId)} · ${KIND_LABEL[d.kind] ?? 'צ׳קליסט'}${clocks.get(d.branchId)?.name ? ` · ${clocks.get(d.branchId)!.name}` : ''}`,
          link: { url: '/owner/checklists' },
          dedupe_key: `checklist-gap:${d.id}`,
        })
      }
    }
    owners = await insertReminders(service, rows)
  }
  return { staff, owners }
}

export async function createStaffReminders(service: Service = createServiceRoleClient()): Promise<{ shiftSoon: number; checklistStaff: number; checklistOwners: number }> {
  const clocks = await branchClocks(service)
  const [shiftSoon, checklist] = await Promise.all([
    shiftSoonReminders(service, clocks).catch((err) => (console.error('shift reminders failed:', err instanceof Error ? err.message : err), 0)),
    checklistReminders(service, clocks).catch((err) => (console.error('checklist reminders failed:', err instanceof Error ? err.message : err), { staff: 0, owners: 0 })),
  ])
  return { shiftSoon, checklistStaff: checklist.staff, checklistOwners: checklist.owners }
}
