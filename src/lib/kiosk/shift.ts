import type { SupabaseClient } from '@supabase/supabase-js'
import { wallClockNow } from '@/lib/shifts/time'
import { projectShift, type ShiftNow, type ShiftWithPeople } from './shift-project'

// The kiosk header's "who is on shift now / closing at" for one branch (the branch the kiosk is linked to, not a
// fixed one): published weeks only, on the branch's own clock, first names only (what the published schedule already
// shows every signed-in employee). Reads today and the day on each side, which covers a shift that began yesterday and
// runs past midnight and a chain that continues tomorrow. The pure part is shift-project.ts.

const DAY_MS = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

type ShiftRow = { id: string; week_id: string; shift_date: string; start_time: string; end_time: string }
type AssignRow = { shift_id: string; staff_id: string | null; staff_name: string | null }

export async function loadKioskShift(service: SupabaseClient, branchId: string, timezone: string, at: Date = new Date()): Promise<ShiftNow> {
  const clock = wallClockNow(timezone || 'Asia/Jerusalem', at)
  const day = Date.parse(`${clock.date}T00:00:00Z`)
  const { data: shiftRows, error } = await service
    .from('shifts')
    .select('id, week_id, shift_date, start_time, end_time')
    .eq('branch_id', branchId)
    .gte('shift_date', isoDay(day - DAY_MS))
    .lte('shift_date', isoDay(day + DAY_MS))
  if (error) throw new Error('kiosk shift read failed')
  const rows = (shiftRows ?? []) as ShiftRow[]
  if (rows.length === 0) return { people: [], closesAt: null }

  const weekIds = [...new Set(rows.map((s) => s.week_id))]
  const { data: weeks, error: weekError } = await service.from('schedule_weeks').select('id').in('id', weekIds).eq('status', 'published')
  if (weekError) throw new Error('kiosk shift read failed')
  const published = new Set((weeks ?? []).map((w) => w.id as string))
  const shifts = rows.filter((s) => published.has(s.week_id))
  if (shifts.length === 0) return { people: [], closesAt: null }

  const { data: assignRows, error: assignError } = await service
    .from('shift_assignments')
    .select('shift_id, staff_id, staff_name')
    .in('shift_id', shifts.map((s) => s.id))
  if (assignError) throw new Error('kiosk shift read failed')
  const assignments = (assignRows ?? []) as AssignRow[]

  // a name stored on the assignment can be empty: fall back to the person's own record
  const missing = [...new Set(assignments.filter((a) => !a.staff_name?.trim() && a.staff_id).map((a) => a.staff_id as string))]
  const { data: staffRows } = missing.length ? await service.from('staff').select('id, first_name, display_name').in('id', missing) : { data: [] }
  const staffName = new Map((staffRows ?? []).map((s) => [s.id as string, ((s.first_name as string | null) || (s.display_name as string | null) || '').trim()]))

  // a shift nobody is assigned to is an open slot, not a staffed shift: it neither names anyone nor holds the place open
  const staffed = new Set(assignments.map((a) => a.shift_id))
  const withPeople: ShiftWithPeople[] = shifts
    .filter((s) => staffed.has(s.id))
    .map((s) => ({
      date: s.shift_date,
      startTime: s.start_time,
      endTime: s.end_time,
      names: assignments
        .filter((a) => a.shift_id === s.id)
        .map((a) => a.staff_name?.trim() || (a.staff_id ? staffName.get(a.staff_id) : '') || '')
        .filter(Boolean),
    }))
  return projectShift(withPeople, clock)
}
