import 'server-only'

// Keeps scheduled shifts on the hours of the shift templates in the branch's settings.
//
// A shift made from a template ("morning") remembers which one (shifts.preset_id) and
// copies its times. Editing a time by hand clears that link (ShiftSheet), so a shift that
// still names a template is, by definition, a shift on the template's hours. Until now
// editing the template left every shift already scheduled on the old hours, and the board,
// the published schedule and the shared PDF all kept showing them — "settings say 07:30,
// the schedule says 07:00".
//
// Now the template wins, in one place, from every direction (settings saved; the schedule
// opened with a leftover difference from before this existed):
//   * live shifts that name a template move to its current hours — today and later only,
//     what already happened stays as it was worked;
//   * the published copy employees read (schedule_weeks.published_snapshot) moves with them,
//     so the board, the employee schedule, "my next shift" and the PDF agree at once;
//   * the people on the changed shifts are told.
// Shifts with no template (custom hours typed by hand) are never touched.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { formatDateLabel, wallClockNow } from './time'
import type { ShiftPreset } from './types'

type Service = ReturnType<typeof createServiceRoleClient>
type Row = Record<string, unknown>

const HM = /^([01]\d|2[0-3]):[0-5]\d$/

export async function syncShiftsToPresets(
  service: Service,
  args: { branchId: string; presets: readonly ShiftPreset[]; timezone: string; actorId?: string | null }
): Promise<{ shifts: number; notified: number }> {
  const { branchId, timezone } = args
  const presets = new Map(args.presets.filter((p) => p.id && HM.test(p.startTime) && HM.test(p.endTime) && p.startTime !== p.endTime).map((p) => [p.id, p]))
  if (presets.size === 0) return { shifts: 0, notified: 0 }
  const today = wallClockNow(timezone).date

  const { data: rows } = await service
    .from('shifts')
    .select('id, week_id, shift_date, start_time, end_time, preset_id')
    .eq('branch_id', branchId)
    .in('preset_id', [...presets.keys()])
    .gte('shift_date', today)
  const future = rows ?? []
  const differs = (r: { start_time?: unknown; end_time?: unknown; preset_id?: unknown }) => {
    const p = presets.get(r.preset_id as string)
    return !!p && (r.start_time !== p.startTime || r.end_time !== p.endTime)
  }

  // ---- live shifts. The "still differs" condition makes a concurrent run a no-op for rows another already moved.
  let moved = 0
  for (const [presetId, preset] of presets) {
    const group = future.filter((r) => r.preset_id === presetId && differs(r))
    if (group.length === 0) continue
    const { data: done } = await service
      .from('shifts')
      .update({ start_time: preset.startTime, end_time: preset.endTime, updated_at: new Date().toISOString() })
      .in('id', group.map((r) => r.id as string))
      .or(`start_time.neq.${preset.startTime},end_time.neq.${preset.endTime}`)
      .select('id')
    moved += done?.length ?? 0
  }

  // ---- the published copy. Looked at on its own (not only for the shifts moved just now) so a
  // week that was published before this ran is brought in line too.
  const weekIds = [...new Set(future.map((r) => r.week_id as string))]
  if (weekIds.length === 0) return { shifts: moved, notified: 0 }
  const { data: weeks } = await service.from('schedule_weeks').select('id, week_start, published_snapshot, updated_at').in('id', weekIds).eq('status', 'published')

  const lines = new Map<string, { date: string; text: string }[]>()
  const weekOfStaff = new Map<string, string>()
  let changedShifts = 0
  for (const week of weeks ?? []) {
    const snapshot = week.published_snapshot as { shifts?: Row[]; assignments?: Row[] } | null
    if (!snapshot?.shifts) continue
    const changed: Row[] = []
    const shifts = snapshot.shifts.map((s) => {
      if (typeof s.shift_date !== 'string' || s.shift_date < today || !differs(s)) return s
      const p = presets.get(s.preset_id as string)!
      changed.push(s)
      return { ...s, start_time: p.startTime, end_time: p.endTime }
    })
    if (changed.length === 0) continue
    const { data: saved } = await service
      .from('schedule_weeks')
      .update({ published_snapshot: { ...snapshot, shifts }, updated_at: new Date().toISOString() })
      .eq('id', week.id)
      .eq('updated_at', week.updated_at)
      .select('id')
    if (!saved?.length) continue // another run got there first and told the people
    changedShifts += changed.length
    for (const s of changed) {
      const p = presets.get(s.preset_id as string)!
      for (const a of snapshot.assignments ?? []) {
        if (a.shift_id !== s.id || typeof a.staff_id !== 'string') continue
        const list = lines.get(a.staff_id) ?? []
        list.push({ date: s.shift_date as string, text: `${formatDateLabel(s.shift_date as string)} · ${p.startTime}–${p.endTime} (היה ${s.start_time}–${s.end_time})` })
        lines.set(a.staff_id, list)
        weekOfStaff.set(a.staff_id, week.week_start as string)
      }
    }
  }

  let notified = 0
  for (const [staffId, list] of lines) {
    list.sort((a, b) => a.date.localeCompare(b.date))
    await service.rpc('sched_notify', {
      p_branch: branchId,
      p_staff: [staffId],
      p_kind: 'schedule.hours_synced',
      p_title: 'שעות המשמרת עודכנו',
      p_body: `שעות המשמרות הותאמו להגדרות הסניף:\n${list.map((l) => l.text).join('\n')}`,
      p_link: { tab: 'schedule', weekStart: weekOfStaff.get(staffId) },
    })
    notified++
  }

  if (moved > 0 || changedShifts > 0) {
    await service.rpc('sched_log', {
      p_branch: branchId,
      p_actor: args.actorId ?? null,
      p_action: 'schedule.hours_synced',
      p_summary: `שעות ${Math.max(moved, changedShifts)} משמרות הותאמו לתבניות המשמרת בהגדרות`,
      p_detail: { shifts: moved, published: changedShifts, notified },
    })
  }
  return { shifts: moved, notified }
}
