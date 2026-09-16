// Row (snake_case, straight off Supabase) <-> domain type (camelCase)
// mapping. Kept in one place so a column rename is a one-file change.

import type {
  Assignment,
  AvailabilitySubmission,
  ScheduleStaffRow,
  ScheduleWeek,
  Shift,
  ShiftAuditEntry,
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

export function serializeRosterRow(row: Record<string, unknown>): ScheduleStaffRow {
  return {
    staffId: row.staff_id as string,
    displayName: (row.display_name as string) || (row.email as string) || 'ללא שם',
    badge: (row.badge as string | null) ?? null,
    active: row.active !== false,
    schedulable: row.schedulable !== false,
    defaultRoleId: (row.default_role_id as string | null) ?? null,
    maxWeeklyHours: (row.max_weekly_hours as number | null) ?? null,
    employmentType: (row.employment_type as string | null) ?? null,
    sortOrder: (row.sort_order as number | null) ?? null,
    note: (row.note as string | null) ?? null,
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
    note: (row.note as string | null) ?? null,
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
    assignmentId: row.assignment_id as string,
    fromStaffId: row.from_staff_id as string,
    toStaffId: (row.to_staff_id as string | null) ?? null,
    status: row.status as SwapRequest['status'],
    reason: (row.reason as string | null) ?? null,
    decidedAt: (row.decided_at as string | null) ?? null,
    decisionNote: (row.decision_note as string | null) ?? null,
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
