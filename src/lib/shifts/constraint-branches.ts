import type { SupabaseClient } from '@supabase/supabase-js'
import { shiftPeriods } from '@/lib/shifts/time-off'

// Which branches a person can send constraints (אילוצים) for, and what hours "morning" and "evening" mean at each (owner, 2026-10-28).
//
// A person belongs to ONE branch (staff.branch_id) or to ALL permanent branches (branch_id null), minus any branch an owner switched
// them off in (schedule_members.schedulable = false): the same rule as the database's sched_staff_branches() and the server guard
// (lib/shifts/guard.ts canViewSchedule), so the screen never offers what the server would refuse. Their wishes belong to the PERSON
// (staff_time_off has no branch), so someone at two branches sends once and it applies to both; what differs is the hours, and that is
// what this list carries so the form can show them side by side. The hours are the branch's own shift templates (shift_settings.presets),
// sorted into morning / evening exactly as the database does (shiftPeriods).

export type ConstraintBranch = { slug: string; name: string; morning: string[]; evening: string[] }

type PresetLike = { startTime?: unknown; endTime?: unknown }

const hm = (value: unknown) => (typeof value === 'string' && /^\d{1,2}:\d{2}/.test(value) ? value.slice(0, 5).padStart(5, '0') : null)

export function hoursByPeriod(presets: unknown): { morning: string[]; evening: string[] } {
  const morning = new Set<string>()
  const evening = new Set<string>()
  for (const preset of Array.isArray(presets) ? (presets as PresetLike[]) : []) {
    const start = hm(preset?.startTime)
    const end = hm(preset?.endTime)
    if (!start || !end) continue
    const range = `${start}–${end}`
    for (const period of shiftPeriods(start, end)) (period === 'morning' ? morning : evening).add(range)
  }
  return { morning: [...morning].sort(), evening: [...evening].sort() }
}

export async function loadConstraintBranches(
  service: SupabaseClient,
  person: { id: string; branch_id: string | null },
  permanentBranches: { id: string; slug: string; name: string }[],
): Promise<ConstraintBranch[]> {
  const mine = permanentBranches.filter((branch) => person.branch_id === null || branch.id === person.branch_id)
  if (!mine.length) return []
  const [{ data: members }, { data: settings }] = await Promise.all([
    service.from('schedule_members').select('branch_id, schedulable').eq('staff_id', person.id).in('branch_id', mine.map((b) => b.id)),
    service.from('shift_settings').select('branch_id, presets').in('branch_id', mine.map((b) => b.id)),
  ])
  const off = new Set((members ?? []).filter((m) => m.schedulable === false).map((m) => m.branch_id as string))
  const presetsOf = new Map((settings ?? []).map((row) => [row.branch_id as string, row.presets]))
  return mine
    .filter((branch) => !off.has(branch.id))
    .map((branch) => ({ slug: branch.slug, name: branch.name, ...hoursByPeriod(presetsOf.get(branch.id)) }))
}
