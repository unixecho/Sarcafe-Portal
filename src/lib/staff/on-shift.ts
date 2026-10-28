import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { clockAbs, shiftEndAbs, shiftStartAbs, type WallClock } from '@/lib/checklists/window'
import { wallClockNow } from '@/lib/shifts/time'

// "Who is on shift right now, and where" for the staff schedule page (owner, 2026-10-28), now as three slides per branch the
// reader swipes between: the PREVIOUS shift, NOW, and the NEXT shift. Published weeks only, judged on each branch's own clock,
// and only what the published schedule already shows every signed-in employee in its "everyone" view: first name, hours, station.
// Event (festival) branches are listed only for someone who works at that event.
//
// A slide is one shift "group": the shifts that share a day and the same end (previous) or the same start (next), so a branch that
// runs two overlapping shifts shows everybody who finished together / starts together, not half of them.

export type OnShiftPerson = { key: string; staffId: string | null; name: string; startTime: string; endTime: string; station: string | null }
export type OnShiftSlot = {
  kind: 'previous' | 'now' | 'next'
  /** The branch-local day this slot is about, as "היום" / "אתמול" / "מחר" / a weekday; null when there is nothing to show. */
  when: string | null
  /** "07:00–13:00" of the earliest shift in the slot (empty slot: null). */
  hours: string | null
  people: OnShiftPerson[]
}
export type OnShiftBranch = {
  id: string
  slug: string
  name: string
  /** Always three, in time order: previous, now, next. */
  slots: OnShiftSlot[]
  /** The people on shift now (same as the "now" slot) and the next shift's start: kept for callers that only need those. */
  people: OnShiftPerson[]
  next: { date: string; startTime: string; label: string } | null
}

type BranchRow = { id: string; slug: string; name: { he?: string } | null; kind: string | null; timezone: string | null }
type ShiftRow = { id: string; week_id: string; branch_id: string; shift_date: string; start_time: string; end_time: string; station_id: string | null }

const DAY_MS = 86_400_000
/** Looking back for the previous shift and ahead for the next one: far enough to cross a closed weekend. */
const LOOK_BACK_DAYS = 4
const LOOK_AHEAD_DAYS = 5
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const dayNo = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)

/** "אתמול", "היום", "מחר", else the weekday; days are compared on the branch's own calendar date. */
export function dayWord(shiftDate: string, today: string): string {
  const diff = dayNo(shiftDate) - dayNo(today)
  if (diff === 0) return 'היום'
  if (diff === 1) return 'מחר'
  if (diff === -1) return 'אתמול'
  return new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${shiftDate}T00:00:00Z`))
}

/** "היום 16:00", "מחר 07:00", else the weekday. */
export function nextLabel(shiftDate: string, startTime: string, today: string): string {
  return `${dayWord(shiftDate, today)} ${startTime.slice(0, 5)}`
}

export async function loadOnShiftNow(service: SupabaseClient, viewerBranchId: string | null): Promise<OnShiftBranch[]> {
  const { data: branchRows } = await service.from('branches').select('id, slug, name, kind, timezone').eq('active', true).order('created_at')
  const branches = ((branchRows ?? []) as BranchRow[]).filter((b) => (b.kind ?? 'permanent') !== 'event' || b.id === viewerBranchId)
  if (!branches.length) return []

  const clocks = new Map<string, WallClock>(branches.map((b) => [b.id, wallClockNow(b.timezone || 'Asia/Jerusalem')]))
  const dates = [...clocks.values()].map((c) => c.date).sort()
  const from = isoDay(Date.parse(`${dates[0]}T00:00:00Z`) - LOOK_BACK_DAYS * DAY_MS)
  const to = isoDay(Date.parse(`${dates.at(-1)}T00:00:00Z`) + LOOK_AHEAD_DAYS * DAY_MS)

  const { data: shiftRows } = await service
    .from('shifts')
    .select('id, week_id, branch_id, shift_date, start_time, end_time, station_id')
    .in('branch_id', branches.map((b) => b.id))
    .gte('shift_date', from)
    .lte('shift_date', to)
    .order('shift_date')
    .order('start_time')
  const weekIds = [...new Set(((shiftRows ?? []) as ShiftRow[]).map((s) => s.week_id))]
  const { data: weeks } = weekIds.length ? await service.from('schedule_weeks').select('id').in('id', weekIds).eq('status', 'published') : { data: [] }
  const published = new Set((weeks ?? []).map((w) => w.id as string))
  const shifts = ((shiftRows ?? []) as ShiftRow[]).filter((s) => published.has(s.week_id))
  const timesOf = (s: ShiftRow) => ({ date: s.shift_date, startTime: s.start_time, endTime: s.end_time })

  // Per branch: the shifts running now, the latest group that finished, and the earliest group still to start.
  const groups = new Map<string, { now: ShiftRow[]; previous: ShiftRow[]; next: ShiftRow[] }>()
  for (const b of branches) {
    const clock = clocks.get(b.id)!
    const here = shifts.filter((s) => s.branch_id === b.id)
    const nowAbs = clockAbs(clock)
    const running = here.filter((s) => shiftStartAbs(timesOf(s)) <= nowAbs && nowAbs < shiftEndAbs(timesOf(s)))
    const finished = here.filter((s) => shiftEndAbs(timesOf(s)) <= nowAbs).sort((x, y) => shiftEndAbs(timesOf(y)) - shiftEndAbs(timesOf(x)))
    const upcoming = here.filter((s) => shiftStartAbs(timesOf(s)) > nowAbs).sort((x, y) => shiftStartAbs(timesOf(x)) - shiftStartAbs(timesOf(y)))
    const last = finished[0]
    const first = upcoming[0]
    groups.set(b.id, {
      now: running,
      previous: last ? finished.filter((s) => s.shift_date === last.shift_date && s.end_time === last.end_time) : [],
      next: first ? upcoming.filter((s) => s.shift_date === first.shift_date && s.start_time === first.start_time) : [],
    })
  }

  const wanted = [...new Set([...groups.values()].flatMap((g) => [...g.now, ...g.previous, ...g.next].map((s) => s.id)))]
  const [{ data: assignRows }, { data: settingRows }] = await Promise.all([
    wanted.length ? service.from('shift_assignments').select('id, shift_id, staff_id, staff_name').in('shift_id', wanted) : Promise.resolve({ data: [] }),
    service.from('shift_settings').select('branch_id, stations').in('branch_id', branches.map((b) => b.id)),
  ])
  const assignments = (assignRows ?? []) as { id: string; shift_id: string; staff_id: string | null; staff_name: string | null }[]
  // A name stored on the assignment can be empty; fall back to the person's own record.
  const missing = [...new Set(assignments.filter((a) => !a.staff_name?.trim() && a.staff_id).map((a) => a.staff_id as string))]
  const { data: staffRows } = missing.length ? await service.from('staff').select('id, first_name, display_name').in('id', missing) : { data: [] }
  const staffName = new Map((staffRows ?? []).map((s) => [s.id as string, ((s.first_name as string | null) || (s.display_name as string | null) || '').trim()]))
  const stationsOf = new Map((settingRows ?? []).map((row) => [row.branch_id as string, Array.isArray(row.stations) ? (row.stations as { id: string; name: string }[]) : []]))

  const peopleOf = (branchId: string, list: ShiftRow[]): OnShiftPerson[] => {
    const ids = new Set(list.map((s) => s.id))
    const byId = new Map(list.map((s) => [s.id, s]))
    return assignments
      .filter((a) => ids.has(a.shift_id))
      .map((a) => {
        const shift = byId.get(a.shift_id)!
        const station = shift.station_id ? stationsOf.get(branchId)?.find((st) => st.id === shift.station_id)?.name ?? null : null
        const name = a.staff_name?.trim() || (a.staff_id ? staffName.get(a.staff_id) : '') || 'עובד/ת'
        return { key: a.id, staffId: a.staff_id, name, startTime: shift.start_time.slice(0, 5), endTime: shift.end_time.slice(0, 5), station }
      })
      .sort((x, y) => x.startTime.localeCompare(y.startTime) || x.name.localeCompare(y.name, 'he'))
  }

  return branches.map((b) => {
    const today = clocks.get(b.id)!.date
    const g = groups.get(b.id)!
    const slot = (kind: OnShiftSlot['kind'], list: ShiftRow[]): OnShiftSlot => {
      const lead = list[0]
      return { kind, when: lead ? dayWord(lead.shift_date, today) : null, hours: lead ? `${lead.start_time.slice(0, 5)}–${lead.end_time.slice(0, 5)}` : null, people: peopleOf(b.id, list) }
    }
    const slots = [slot('previous', g.previous), slot('now', g.now), slot('next', g.next)]
    const upcoming = g.next[0]
    return {
      id: b.id,
      slug: b.slug,
      name: b.name?.he ?? b.slug,
      slots,
      people: slots[1]!.people,
      next: upcoming ? { date: upcoming.shift_date, startTime: upcoming.start_time.slice(0, 5), label: nextLabel(upcoming.shift_date, upcoming.start_time, today) } : null,
    }
  })
}
