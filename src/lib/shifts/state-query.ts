// Server-only read path. Runs on the SERVICE ROLE client (the caller was
// already authorized by requireScheduleViewer()/requireScheduleManager()
// in the route), so this must do by hand what RLS would otherwise enforce
// for a non-manager: read published-only data from published_snapshot,
// never the live schedule_weeks/shifts/shift_assignments rows, and scope
// availability/swaps to what that viewer is actually allowed to see.

import { createServiceRoleClient } from '@/lib/supabase/server'
import type { StaffRow } from '@/lib/owner/guard'
import { addDays, weekStartOf } from './time'
import {
  serializeAssignment,
  serializeAuditEntry,
  serializeAvailability,
  serializeRosterRow,
  serializeSettings,
  serializeShift,
  serializeSwap,
  serializeWeek,
} from './serialize'
import { DEFAULT_PRESETS, DEFAULT_ROLES, DEFAULT_SAFETY, DEFAULT_STATIONS } from './config'
import type { Assignment, Shift, ShiftsDB } from './types'

const AUDIT_LIMIT = 50

export async function loadShiftsState(
  branchId: string,
  requestedWeekStart: string,
  viewer: StaffRow,
  isManager: boolean,
  canDelegate: boolean
): Promise<ShiftsDB> {
  const service = createServiceRoleClient()
  const centerWeek = weekStartOf(requestedWeekStart)
  const windowStarts = [addDays(centerWeek, -7), centerWeek, addDays(centerWeek, 7)]

  const settingsRow = await ensureSettingsRow(branchId)
  const settings = serializeSettings(settingsRow)
  // A branch with nothing customized yet starts from the app's own
  // defaults rather than an empty catalog the owner has to build from
  // scratch — mirrors how MenuOnboardingWizard hands a first category to
  // an empty menu rather than leaving it blank.
  if (settings.roles.length === 0) settings.roles = DEFAULT_ROLES
  if (settings.stations.length === 0) settings.stations = DEFAULT_STATIONS
  if (settings.presets.length === 0) settings.presets = DEFAULT_PRESETS
  if (!settingsRow.safety) settings.safety = DEFAULT_SAFETY

  const roster = await loadRoster(branchId)

  const [weeks, shifts, assignments] = isManager
    ? await loadLive(branchId, windowStarts)
    : await loadPublishedOnly(branchId, windowStarts)

  const availability = settings.features.availability ? await loadAvailability(branchId, windowStarts, viewer, isManager) : []
  const swaps = settings.features.swaps ? await loadSwaps(branchId, viewer, isManager) : []
  const audit = isManager ? await loadAudit(branchId) : []

  return {
    branchId,
    settings,
    roster,
    weeks,
    shifts,
    assignments,
    availability,
    swaps,
    audit,
    viewerStaffId: viewer.id,
    viewerCanManage: isManager,
    viewerCanDelegate: canDelegate,
  }
}

async function ensureSettingsRow(branchId: string): Promise<Record<string, unknown>> {
  const service = createServiceRoleClient()
  const { data } = await service.from('shift_settings').select('*').eq('branch_id', branchId).maybeSingle()
  if (data) return data as Record<string, unknown>

  // A branch created after this migration ran has no seeded row —
  // create one on first access rather than requiring a manual backfill.
  const { data: created } = await service.from('shift_settings').insert({ branch_id: branchId }).select('*').single()
  return (created as Record<string, unknown>) ?? { branch_id: branchId }
}

async function loadRoster(branchId: string) {
  const service = createServiceRoleClient()
  const [{ data: staffRows }, { data: memberRows }] = await Promise.all([
    service.from('staff').select('id, display_name, email, badge, active, branch_id').eq('active', true),
    service.from('schedule_members').select('*').eq('branch_id', branchId),
  ])
  const members = new Map((memberRows ?? []).map((m) => [m.staff_id as string, m]))
  return (staffRows ?? [])
    .filter((s) => s.branch_id === null || s.branch_id === branchId)
    .map((s) => serializeRosterRow({ ...s, staff_id: s.id, ...(members.get(s.id) ?? {}) }))
}

async function loadLive(branchId: string, windowStarts: string[]): Promise<[ShiftsDB['weeks'], Shift[], Assignment[]]> {
  const service = createServiceRoleClient()
  const { data: weekRows } = await service
    .from('schedule_weeks')
    .select('*')
    .eq('branch_id', branchId)
    .in('week_start', windowStarts)

  // A manager always gets all three window weeks back, even ones nobody
  // has touched yet — the UI never has to special-case "this week doesn't
  // exist in the database yet" before it can create a first shift.
  const existingStarts = new Set((weekRows ?? []).map((w) => w.week_start as string))
  const missing = windowStarts.filter((s) => !existingStarts.has(s))
  if (missing.length > 0) {
    await service.from('schedule_weeks').insert(missing.map((week_start) => ({ branch_id: branchId, week_start }))).select('id')
    const { data: refreshed } = await service.from('schedule_weeks').select('*').eq('branch_id', branchId).in('week_start', windowStarts)
    const weeks = (refreshed ?? []).map(serializeWeek)
    return loadShiftsAndAssignmentsFor(service, weeks)
  }

  const weeks = (weekRows ?? []).map(serializeWeek)
  return loadShiftsAndAssignmentsFor(service, weeks)
}

async function loadShiftsAndAssignmentsFor(
  service: ReturnType<typeof createServiceRoleClient>,
  weeks: ShiftsDB['weeks']
): Promise<[ShiftsDB['weeks'], Shift[], Assignment[]]> {
  const weekIds = weeks.map((w) => w.id)
  if (weekIds.length === 0) return [weeks, [], []]

  const { data: shiftRows } = await service.from('shifts').select('*').in('week_id', weekIds)
  const shifts = (shiftRows ?? []).map(serializeShift)
  const shiftIds = shifts.map((s) => s.id)
  if (shiftIds.length === 0) return [weeks, shifts, []]

  const { data: assignmentRows } = await service.from('shift_assignments').select('*').in('shift_id', shiftIds)
  return [weeks, shifts, (assignmentRows ?? []).map(serializeAssignment)]
}

/** Staff never read the live tables — everything here comes out of each
 *  published week's frozen snapshot, matching the RLS backstop exactly. */
async function loadPublishedOnly(branchId: string, windowStarts: string[]): Promise<[ShiftsDB['weeks'], Shift[], Assignment[]]> {
  const service = createServiceRoleClient()
  const { data: weekRows } = await service
    .from('schedule_weeks')
    .select('id, branch_id, week_start, status, version, published_at, day_notes, dismissed_warnings, published_snapshot')
    .eq('branch_id', branchId)
    .eq('status', 'published')
    .in('week_start', windowStarts)

  const weeks = (weekRows ?? []).map(serializeWeek)
  const shifts: Shift[] = []
  const assignments: Assignment[] = []
  for (const week of weeks) {
    for (const raw of week.publishedSnapshot?.shifts ?? []) shifts.push(serializeShift(raw as unknown as Record<string, unknown>))
    for (const raw of week.publishedSnapshot?.assignments ?? []) assignments.push(serializeAssignment(raw as unknown as Record<string, unknown>))
  }
  return [weeks, shifts, assignments]
}

async function loadAvailability(branchId: string, windowStarts: string[], viewer: StaffRow, isManager: boolean) {
  const service = createServiceRoleClient()
  let query = service.from('shift_availability').select('*').eq('branch_id', branchId).in('week_start', windowStarts)
  if (!isManager) query = query.eq('staff_id', viewer.id)
  const { data } = await query
  return (data ?? []).map(serializeAvailability)
}

async function loadSwaps(branchId: string, viewer: StaffRow, isManager: boolean) {
  const service = createServiceRoleClient()
  const { data } = await service.from('shift_swaps').select('*').eq('branch_id', branchId).order('created_at', { ascending: false })
  const all = (data ?? []).map(serializeSwap)
  if (isManager) return all
  // Mirrors the RLS "swap visibility" policy exactly: own swaps (either
  // side) plus anything still open to browse and accept.
  return all.filter((s) => s.fromStaffId === viewer.id || s.toStaffId === viewer.id || s.status === 'open')
}

async function loadAudit(branchId: string) {
  const service = createServiceRoleClient()
  const { data } = await service
    .from('shift_audit')
    .select('id, actor_name, action, summary, detail, created_at')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(AUDIT_LIMIT)
  return (data ?? []).map(serializeAuditEntry)
}
