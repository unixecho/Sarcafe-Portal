// Server-only read path. Runs on the SERVICE ROLE client (the caller was
// already authorized by requirePublishedScheduleViewer()/requireScheduleManager()
// in the route), so this must do by hand what RLS would otherwise enforce
// for a non-manager: read published-only data from published_snapshot,
// never the live schedule_weeks/shifts/shift_assignments rows, and scope
// availability / swaps / requests / notifications to what that viewer is
// actually allowed to see.

import { createServiceRoleClient } from '@/lib/supabase/server'
import type { StaffRow } from '@/lib/owner/guard'
import { isOp } from '@/lib/staff/access'
import { canViewSchedule } from './access'
import { addDays, durationMinutes, wallClockNow, weekStartOf } from './time'
import {
  serializeAssignment,
  serializeAuditEntry,
  serializeAvailability,
  serializeNotification,
  serializeRequest,
  serializeRosterRow,
  serializeSettings,
  serializeShift,
  serializeSwap,
  serializeWeek,
} from './serialize'
import { DEFAULT_PRESETS, DEFAULT_ROLES, DEFAULT_SAFETY, DEFAULT_STATIONS } from './config'
import type { Assignment, PlanningShift, SaturdayBalance, Shift, ShiftsDB } from './types'

const AUDIT_LIMIT = 60
const HISTORY_LIMIT = 150
const NOTIFICATION_LIMIT = 40

type Service = ReturnType<typeof createServiceRoleClient>

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
  const branchScoped = canViewSchedule(viewer, branchId)

  const settingsRow = await ensureSettingsRow(service, branchId)
  const settings = serializeSettings(settingsRow)
  // A branch with nothing customized yet starts from the app's own
  // defaults rather than an empty catalog the owner has to build from
  // scratch — mirrors how MenuOnboardingWizard hands a first category to
  // an empty menu rather than leaving it blank.
  if (settings.roles.length === 0) settings.roles = DEFAULT_ROLES
  if (settings.stations.length === 0) settings.stations = DEFAULT_STATIONS
  if (settings.presets.length === 0) settings.presets = DEFAULT_PRESETS
  if (!settingsRow.safety) settings.safety = DEFAULT_SAFETY
  // Who may manage is the manager's business; it is not something to hand every employee.
  if (!isManager) settings.scheduleManagers = []
  // Cross-branch access is a published board, not membership in that branch.
  if (!branchScoped) settings.features = { ...settings.features, availability: false, swaps: false }

  const [roster, tz] = await Promise.all([loadRoster(service, branchId, isManager, viewer.id, branchScoped), branchTimezone(service, branchId)])

  const [weeks, shifts, assignments] = isManager
    ? await loadLive(service, branchId, windowStarts)
    : await loadPublishedOnly(service, branchId, windowStarts)

  const [availability, swaps, requests, notifications, audit, planningShifts, saturdayBalance] = await Promise.all([
    branchScoped && settings.features.availability ? loadAvailability(service, branchId, windowStarts, viewer, isManager) : Promise.resolve([]),
    branchScoped && settings.features.swaps ? loadSwaps(service, branchId, viewer, isManager) : Promise.resolve([]),
    loadRequests(service, branchId, viewer, isManager),
    loadNotifications(service, branchId, viewer),
    isManager ? loadAudit(service, branchId) : Promise.resolve([]),
    branchScoped
      ? loadPlanningShifts(service, branchId, centerWeek)
      : Promise.resolve(shifts.map((s) => ({ id: s.id, weekId: s.weekId, date: s.date, startTime: s.startTime, endTime: s.endTime, presetId: s.presetId, requestsOpen: s.requestsOpen }))),
    isManager ? loadSaturdayBalance(service, branchId, centerWeek) : Promise.resolve([]),
  ])

  return {
    branchId,
    settings,
    roster,
    weeks,
    shifts,
    assignments,
    availability,
    swaps,
    requests,
    planningShifts,
    saturdayBalance,
    notifications: notifications.items,
    unreadCount: notifications.unread,
    audit,
    now: wallClockNow(tz),
    viewerStaffId: viewer.id,
    viewerCanManage: isManager,
    viewerCanDelegate: canDelegate,
  }
}

/** Only the shift menu is public to staff before publishing. Assignees and private notes stay private. */
async function loadPlanningShifts(service: Service, branchId: string, centerWeek: string): Promise<PlanningShift[]> {
  const { data } = await service.from('shifts')
    .select('id, week_id, shift_date, start_time, end_time, preset_id, requests_open')
    .eq('branch_id', branchId).gte('shift_date', centerWeek).lte('shift_date', addDays(centerWeek, 13))
    .order('shift_date').order('start_time')
  return (data ?? []).map((s) => ({ id: s.id, weekId: s.week_id, date: s.shift_date, startTime: s.start_time, endTime: s.end_time, presetId: s.preset_id, requestsOpen: s.requests_open === true }))
}

async function loadSaturdayBalance(service: Service, branchId: string, centerWeek: string): Promise<SaturdayBalance[]> {
  const { data: weeks } = await service.from('schedule_weeks').select('id')
    .eq('branch_id', branchId).eq('status', 'published').gte('week_start', addDays(centerWeek, -84)).lt('week_start', centerWeek)
  if (!weeks?.length) return []
  const { data: shifts } = await service.from('shifts').select('id, shift_date, start_time, end_time').in('week_id', weeks.map((w) => w.id))
  const saturdays = (shifts ?? []).filter((s) => new Date(`${s.shift_date}T00:00:00Z`).getUTCDay() === 6)
  if (!saturdays.length) return []
  const byShift = new Map(saturdays.map((s) => [s.id, s]))
  const { data: assignments } = await service.from('shift_assignments').select('shift_id, staff_id').in('shift_id', saturdays.map((s) => s.id))
  const balance = new Map<string, SaturdayBalance>()
  for (const a of assignments ?? []) {
    const shift = byShift.get(a.shift_id)
    if (!shift || !a.staff_id) continue
    const item = balance.get(a.staff_id) ?? { staffId: a.staff_id, minutes: 0, shifts: 0 }
    item.minutes += durationMinutes({ startTime: shift.start_time, endTime: shift.end_time })
    item.shifts++
    balance.set(a.staff_id, item)
  }
  return [...balance.values()]
}

async function ensureSettingsRow(service: Service, branchId: string): Promise<Record<string, unknown>> {
  const { data } = await service.from('shift_settings').select('*').eq('branch_id', branchId).maybeSingle()
  if (data) return data as Record<string, unknown>

  // A branch created after the scheduling migration has no seeded row —
  // create one on first access rather than requiring a manual backfill.
  const { data: created } = await service
    .from('shift_settings')
    .upsert({ branch_id: branchId }, { onConflict: 'branch_id', ignoreDuplicates: true })
    .select('*')
    .maybeSingle()
  if (created) return created as Record<string, unknown>
  const { data: again } = await service.from('shift_settings').select('*').eq('branch_id', branchId).maybeSingle()
  return (again as Record<string, unknown>) ?? { branch_id: branchId }
}

async function branchTimezone(service: Service, branchId: string): Promise<string> {
  const { data } = await service.from('branches').select('timezone').eq('id', branchId).maybeSingle()
  return (data?.timezone as string | undefined) || 'Asia/Jerusalem'
}

/**
 * Everyone who can be (or has been) on this branch's schedule, with a REAL name —
 * resolved from display name / first+last / POS nickname / email (lib/shifts/
 * names.ts), so a person without an email is never "unnamed".
 *
 * A manager also gets the inactive people (so a shift still held by someone who
 * has left can be flagged); an employee gets only active colleagues, and only
 * their names — never the manager's private notes or hour caps.
 */
async function loadRoster(service: Service, branchId: string, isManager: boolean, viewerStaffId: string, branchScoped: boolean) {
  const [{ data: staffRows }, { data: memberRows }] = await Promise.all([
    service
      .from('staff')
      .select('id, display_name, first_name, last_name, handle, email, badge, role, active, branch_id, auth_user_id, avatar_emoji'),
    service.from('schedule_members').select('*').eq('branch_id', branchId),
  ])
  const members = new Map((memberRows ?? []).map((m) => [m.staff_id as string, m as Record<string, unknown>]))
  return (staffRows ?? [])
    .filter((s) => (isManager || s.active !== false) && (branchScoped ? s.branch_id === null || s.branch_id === branchId || isOp(s) : s.id === viewerStaffId))
    .map((s) => serializeRosterRow(s as Record<string, unknown>, members.get(s.id as string), isManager))
}

async function loadLive(service: Service, branchId: string, windowStarts: string[]): Promise<[ShiftsDB['weeks'], Shift[], Assignment[]]> {
  const { data: weekRows } = await service.from('schedule_weeks').select('*').eq('branch_id', branchId).in('week_start', windowStarts)

  // A manager always gets all three window weeks back, even ones nobody
  // has touched yet — the UI never has to special-case "this week doesn't
  // exist in the database yet" before it can create a first shift.
  const existingStarts = new Set((weekRows ?? []).map((w) => w.week_start as string))
  const missing = windowStarts.filter((s) => !existingStarts.has(s))
  let rows = weekRows ?? []
  if (missing.length > 0) {
    await service
      .from('schedule_weeks')
      .upsert(
        missing.map((week_start) => ({ branch_id: branchId, week_start })),
        { onConflict: 'branch_id,week_start', ignoreDuplicates: true }
      )
    const { data: refreshed } = await service.from('schedule_weeks').select('*').eq('branch_id', branchId).in('week_start', windowStarts)
    rows = refreshed ?? []
  }
  const weeks = rows.map(serializeWeek).sort((a, b) => a.weekStart.localeCompare(b.weekStart))
  return loadShiftsAndAssignmentsFor(service, weeks)
}

async function loadShiftsAndAssignmentsFor(service: Service, weeks: ShiftsDB['weeks']): Promise<[ShiftsDB['weeks'], Shift[], Assignment[]]> {
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
async function loadPublishedOnly(service: Service, branchId: string, windowStarts: string[]): Promise<[ShiftsDB['weeks'], Shift[], Assignment[]]> {
  const { data: weekRows } = await service
    .from('schedule_weeks')
    .select('id, branch_id, week_start, status, version, published_at, day_notes, dismissed_warnings, published_snapshot')
    .eq('branch_id', branchId)
    .eq('status', 'published')
    .in('week_start', windowStarts)

  const weeks = (weekRows ?? []).map(serializeWeek).sort((a, b) => a.weekStart.localeCompare(b.weekStart))
  const shifts: Shift[] = []
  const assignments: Assignment[] = []
  for (const week of weeks) {
    for (const raw of week.publishedSnapshot?.shifts ?? []) shifts.push(serializeShift(raw as unknown as Record<string, unknown>))
    for (const raw of week.publishedSnapshot?.assignments ?? []) assignments.push(serializeAssignment(raw as unknown as Record<string, unknown>))
  }
  // The frozen copy is the employee's whole world: it is never sent back to them whole.
  return [weeks.map((w) => ({ ...w, publishedSnapshot: null })), shifts, assignments]
}

async function loadAvailability(service: Service, branchId: string, windowStarts: string[], viewer: StaffRow, isManager: boolean) {
  let query = service.from('shift_availability').select('*').eq('branch_id', branchId).in('week_start', [...windowStarts, addDays(windowStarts[2]!, 7)])
  if (!isManager) query = query.eq('staff_id', viewer.id)
  const { data } = await query
  return (data ?? []).map(serializeAvailability)
}

/** A manager sees every swap of the branch. An employee sees their own (either
 *  side) plus swaps open to anyone — and NOT a swap one colleague aimed at another. */
async function loadSwaps(service: Service, branchId: string, viewer: StaffRow, isManager: boolean) {
  let query = service.from('shift_swaps').select('*').eq('branch_id', branchId).order('created_at', { ascending: false }).limit(HISTORY_LIMIT)
  if (!isManager) {
    query = query.or(`from_staff_id.eq.${viewer.id},to_staff_id.eq.${viewer.id},and(status.eq.open,to_staff_id.is.null)`)
  }
  const { data } = await query
  return (data ?? []).map(serializeSwap)
}

async function loadRequests(service: Service, branchId: string, viewer: StaffRow, isManager: boolean) {
  let query = service.from('shift_requests').select('*').eq('branch_id', branchId).order('created_at', { ascending: false }).limit(HISTORY_LIMIT)
  if (!isManager) query = query.eq('staff_id', viewer.id)
  const { data } = await query
  return (data ?? []).map(serializeRequest)
}

async function loadNotifications(service: Service, branchId: string, viewer: StaffRow) {
  const [{ data }, { count }] = await Promise.all([
    service
      .from('schedule_notifications')
      .select('*')
      .eq('staff_id', viewer.id)
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })
      .limit(NOTIFICATION_LIMIT),
    service
      .from('schedule_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('staff_id', viewer.id)
      .eq('branch_id', branchId)
      .is('read_at', null),
  ])
  return { items: (data ?? []).map(serializeNotification), unread: count ?? 0 }
}

async function loadAudit(service: Service, branchId: string) {
  const { data } = await service
    .from('shift_audit')
    .select('id, actor_name, action, summary, detail, created_at')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(AUDIT_LIMIT)
  return (data ?? []).map(serializeAuditEntry)
}
