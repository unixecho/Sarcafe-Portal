import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { KIND_LABELS, type ChecklistKind } from '@/lib/checklists/types'
import { clockAbs, shiftEndAbs, shiftStartAbs, type WallClock } from '@/lib/checklists/window'
import { wallClockNow } from '@/lib/shifts/time'

// What the staff home's shift-status card needs: the shift the person is working right now (if any), the next
// one, and the checklists that belong to each. Published weeks only — a draft shift is not "yours" yet.

export type ShiftChecklistBrief = { id: string; kind: ChecklistKind; kindLabel: string; status: 'pending' | 'in_progress' | 'submitted' }
export type ShiftBrief = {
  id: string
  date: string
  startTime: string
  endTime: string
  branchSlug: string
  branchName: string
  place: string
  checklists: ShiftChecklistBrief[]
}
export type ShiftStatus = { serverNow: WallClock; current: ShiftBrief | null; next: ShiftBrief | null }

const KIND_ORDER: Record<ChecklistKind, number> = { opening: 0, handover: 1, closing: 2 }

export async function loadShiftStatus(service: SupabaseClient, staffId: string): Promise<ShiftStatus> {
  const fallbackNow = wallClockNow('Asia/Jerusalem')
  const { data: mine } = await service.from('shift_assignments').select('shift_id').eq('staff_id', staffId)
  const ids = (mine ?? []).map((row) => row.shift_id as string)
  if (!ids.length) return { serverNow: fallbackNow, current: null, next: null }

  // From yesterday: a shift that began yesterday evening may still be running after midnight.
  const since = new Date(Date.parse(`${fallbackNow.date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  const { data: shifts } = await service
    .from('shifts')
    .select('id, week_id, branch_id, shift_date, start_time, end_time, station_id')
    .in('id', ids)
    .gte('shift_date', since)
    .order('shift_date')
    .order('start_time')
  const weekIds = [...new Set((shifts ?? []).map((shift) => shift.week_id as string))]
  const branchIds = [...new Set((shifts ?? []).map((shift) => shift.branch_id as string))]
  if (!weekIds.length) return { serverNow: fallbackNow, current: null, next: null }
  const [{ data: weeks }, { data: branches }, { data: settings }] = await Promise.all([
    service.from('schedule_weeks').select('id').in('id', weekIds).eq('status', 'published'),
    service.from('branches').select('id, slug, name, kind, timezone').in('id', branchIds),
    service.from('shift_settings').select('branch_id, stations').in('branch_id', branchIds),
  ])
  const published = new Set((weeks ?? []).map((week) => week.id as string))
  const branchById = new Map((branches ?? []).map((branch) => [branch.id as string, branch]))
  const stationsByBranch = new Map((settings ?? []).map((row) => [row.branch_id as string, Array.isArray(row.stations) ? (row.stations as { id: string; name: string }[]) : []]))
  const clockOf = (branchId: string) => wallClockNow((branchById.get(branchId)?.timezone as string | null) || 'Asia/Jerusalem')

  type Candidate = { row: NonNullable<typeof shifts>[number]; times: { date: string; startTime: string; endTime: string }; now: WallClock }
  const live: Candidate[] = (shifts ?? [])
    .filter((row) => published.has(row.week_id as string))
    .map((row) => ({ row, times: { date: row.shift_date as string, startTime: row.start_time as string, endTime: row.end_time as string }, now: clockOf(row.branch_id as string) }))
  const current = live.find((c) => shiftStartAbs(c.times) <= clockAbs(c.now) && clockAbs(c.now) < shiftEndAbs(c.times)) ?? null
  const next = live.find((c) => shiftStartAbs(c.times) > clockAbs(c.now)) ?? null

  const wanted = [current, next].filter((c): c is Candidate => c !== null)
  const checklistsFor = async () => {
    const { data } = wanted.length
      ? await service.from('checklist_assignments').select('id, shift_id, checklist_kind, status').eq('staff_id', staffId).in('shift_id', wanted.map((c) => c.row.id as string))
      : { data: [] }
    return data ?? []
  }
  let rows = await checklistsFor()
  // The forms are made when a week is published; if none exist yet for these shifts, ask for them once.
  const missing = wanted.filter((c) => !rows.some((row) => row.shift_id === c.row.id))
  if (missing.length) {
    await Promise.all([...new Set(missing.map((c) => c.row.week_id as string))].map((weekId) => Promise.resolve(service.rpc('sync_checklist_assignments', { p_week_id: weekId })).catch(() => undefined)))
    rows = await checklistsFor()
  }

  const brief = (c: Candidate | null): ShiftBrief | null => {
    if (!c) return null
    const branch = branchById.get(c.row.branch_id as string)
    const stations = stationsByBranch.get(c.row.branch_id as string) ?? []
    const station = c.row.station_id ? stations.find((item) => item.id === c.row.station_id)?.name : undefined
    const branchName = (branch?.name as { he?: string } | null)?.he ?? ''
    // A festival (event) branch is told by its station, as before; permanent branches by name (+ station).
    const place = branch?.kind === 'event' || !branchName ? station || 'העמדה טרם נקבעה' : station ? `${branchName} · ${station}` : branchName
    return {
      id: c.row.id as string,
      date: c.times.date,
      startTime: c.times.startTime,
      endTime: c.times.endTime,
      branchSlug: (branch?.slug as string | undefined) ?? '',
      branchName,
      place,
      checklists: rows
        .filter((row) => row.shift_id === c.row.id)
        .map((row) => ({ id: row.id as string, kind: row.checklist_kind as ChecklistKind, kindLabel: KIND_LABELS[row.checklist_kind as ChecklistKind], status: row.status as ShiftChecklistBrief['status'] }))
        .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]),
    }
  }
  return { serverNow: (current ?? next)?.now ?? fallbackNow, current: brief(current), next: brief(next) }
}
