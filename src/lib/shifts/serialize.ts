// Row (snake_case, straight off Supabase) <-> domain type (camelCase)
// mapping. Kept in one place so a column rename is a one-file change.

import { staffDisplayName } from './names'
import type {
  Assignment,
  AvailabilitySubmission,
  ScheduleNotification,
  ScheduleStaffRow,
  ScheduleWeek,
  Shift,
  ShiftAuditEntry,
  ShiftRequest,
  ShiftSettings,
  SwapRequest,
} from './types'

export function serializeSettings(row: Record<string, unknown>): ShiftSettings {
  return {
    branchId: row.branch_id as string,
    workingDays: (row.working_days as number[]) ?? [0, 1, 2, 3, 4, 5, 6],
    openTime: (row.open_time as string) ?? '07:00',
    closeTime: (row.close_time as string) ?? '19:00',
    dayHours: (row.day_hours as ShiftSettings['dayHours']) ?? {},
    roles: (row.roles as ShiftSettings['roles']) ?? [],
    stations: (row.stations as ShiftSettings['stations']) ?? [],
    presets: (row.presets as ShiftSettings['presets']) ?? [],
    safety: (row.safety as ShiftSettings['safety']) ?? { maxWeeklyHours: 42, minRestHours: 10, maxDailyHours: 10, maxConsecutiveDays: 6 },
    ruleSeverity: (row.rule_severity as ShiftSettings['ruleSeverity']) ?? {},
    features: (row.features as ShiftSettings['features']) ?? { availability: true, swaps: true },
    scheduleManagers: (row.schedule_managers as string[]) ?? [],
    onboardedAt: (row.onboarded_at as string | null) ?? null,
  }
}

/**
 * One person as the scheduler sees them. `manager` is whether the VIEWER may see
 * the manager's private bookkeeping (default role, hour cap, employment type,
 * the note) — an ordinary employee gets a name and nothing else, so one person's
 * private note can never reach a colleague.
 */
export function serializeRosterRow(staff: Record<string, unknown>, member: Record<string, unknown> | undefined, manager: boolean): ScheduleStaffRow {
  return {
    staffId: staff.id as string,
    displayName: staffDisplayName(staff),
    badge: (staff.badge as string | null) ?? null,
    active: staff.active !== false,
    schedulable: member ? member.schedulable !== false : true,
    defaultRoleId: manager ? ((member?.default_role_id as string | null) ?? null) : null,
    maxWeeklyHours: manager ? ((member?.max_weekly_hours as number | null) ?? null) : null,
    employmentType: manager ? ((member?.employment_type as string | null) ?? null) : null,
    sortOrder: manager ? ((member?.sort_order as number | null) ?? null) : null,
    note: manager ? ((member?.note as string | null) ?? null) : null,
    // Not private: it only says whether the person can open the app — which a colleague needs to
    // know before sending them a swap they could never answer.
    hasLogin: staff.auth_user_id != null,
  }
}

export function serializeWeek(row: Record<string, unknown>): ScheduleWeek {
  return {
    id: row.id as string,
    branchId: row.branch_id as string,
    weekStart: row.week_start as string,
    status: row.status as 'draft' | 'published',
    version: (row.version as number) ?? 0,
    publishedAt: (row.published_at as string | null) ?? null,
    dayNotes: (row.day_notes as Record<string, string>) ?? {},
    dismissedWarnings: (row.dismissed_warnings as string[]) ?? [],
    publishedSnapshot: (row.published_snapshot as ScheduleWeek['publishedSnapshot']) ?? null,
  }
}

export function serializeShift(row: Record<string, unknown>): Shift {
  return {
    id: row.id as string,
    branchId: row.branch_id as string,
    weekId: row.week_id as string,
    date: row.shift_date as string,
    startTime: row.start_time as string,
    endTime: row.end_time as string,
    presetId: (row.preset_id as string | null) ?? null,
    stationId: (row.station_id as string | null) ?? null,
    requirements: (row.requirements as Shift['requirements']) ?? [],
    requestsOpen: row.requests_open === true,
    note: (row.note as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
  }
}

export function serializeAssignment(row: Record<string, unknown>): Assignment {
  return {
    id: row.id as string,
    shiftId: row.shift_id as string,
    staffId: (row.staff_id as string | null) ?? null,
    staffName: (row.staff_name as string | null) ?? null,
    roleId: (row.role_id as string | null) ?? null,
    status: (row.status as Assignment['status']) ?? 'assigned',
  }
}

export function serializeAvailability(row: Record<string, unknown>): AvailabilitySubmission {
  return {
    id: row.id as string,
    staffId: row.staff_id as string,
    weekStart: row.week_start as string,
    entries: (row.entries as AvailabilitySubmission['entries']) ?? [],
    note: (row.note as string | null) ?? null,
    status: (row.status as AvailabilitySubmission['status']) ?? 'draft',
  }
}

export function serializeSwap(row: Record<string, unknown>): SwapRequest {
  return {
    id: row.id as string,
    assignmentId: (row.assignment_id as string | null) ?? null,
    returnAssignmentId: (row.return_assignment_id as string | null) ?? null,
    fromStaffId: row.from_staff_id as string,
    fromStaffName: (row.from_staff_name as string | null) ?? null,
    toStaffId: (row.to_staff_id as string | null) ?? null,
    toStaffName: (row.to_staff_name as string | null) ?? null,
    status: row.status as SwapRequest['status'],
    reason: (row.reason as string | null) ?? null,
    cancelReason: (row.cancel_reason as string | null) ?? null,
    decidedAt: (row.decided_at as string | null) ?? null,
    decisionNote: (row.decision_note as string | null) ?? null,
    createdAt: row.created_at as string,
    terms: (row.terms as SwapRequest['terms']) ?? {},
  }
}

export function serializeRequest(row: Record<string, unknown>): ShiftRequest {
  return {
    id: row.id as string,
    shiftId: (row.shift_id as string | null) ?? null,
    staffId: row.staff_id as string,
    staffName: (row.staff_name as string | null) ?? null,
    status: row.status as ShiftRequest['status'],
    note: (row.note as string | null) ?? null,
    decisionNote: (row.decision_note as string | null) ?? null,
    cancelReason: (row.cancel_reason as string | null) ?? null,
    decidedAt: (row.decided_at as string | null) ?? null,
    createdAt: row.created_at as string,
    terms: (row.terms as ShiftRequest['terms']) ?? {},
  }
}

export function serializeNotification(row: Record<string, unknown>): ScheduleNotification {
  return {
    id: row.id as string,
    kind: row.kind as string,
    title: row.title as string,
    body: (row.body as string | null) ?? null,
    link: (row.link as ScheduleNotification['link']) ?? {},
    createdAt: row.created_at as string,
    readAt: (row.read_at as string | null) ?? null,
  }
}

export function serializeAuditEntry(row: Record<string, unknown>): ShiftAuditEntry {
  return {
    id: String(row.id),
    actorName: (row.actor_name as string | null) ?? null,
    action: row.action as string,
    summary: (row.summary as string | null) ?? null,
    detail: (row.detail as Record<string, unknown> | null) ?? null,
    createdAt: row.created_at as string,
  }
}
