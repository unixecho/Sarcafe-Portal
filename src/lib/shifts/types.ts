// The shift-scheduling domain model — adapted from AyekaBar's
// src/lib/shifts/types.ts, branch-scoped (branchId instead of an implicit
// single venue) and using plain Hebrew strings for role/station/preset
// vocabulary instead of a trilingual Tri type: unlike menu content, none
// of this is ever customer-facing, matching every other staff/owner-only
// screen in this app (StaffManager, AuditTrail, FeedbackInbox all do the
// same — hardcoded Hebrew, no i18n).

export type HM = string // "HH:MM"
export type ISODate = string // "YYYY-MM-DD"

export type ShiftRole = { id: string; name: string; color: string }
export type Station = { id: string; name: string; emoji: string }
export type RoleRequirement = { roleId: string; min: number; max?: number }
export type ShiftPreset = { id: string; name: string; startTime: HM; endTime: HM; roleId?: string; stationId?: string }

export type SafetyRules = {
  maxWeeklyHours: number
  minRestHours: number
  maxDailyHours: number
  maxConsecutiveDays: number
}

export type FeatureFlags = { availability: boolean; swaps: boolean }

export type RuleSeverity = 'error' | 'warning' | 'off'

export type ShiftSettings = {
  branchId: string
  workingDays: number[] // 0=Sun..6=Sat (JS getDay())
  openTime: HM
  closeTime: HM
  dayHours: Record<number, { open: HM; close: HM }>
  roles: ShiftRole[]
  stations: Station[]
  presets: ShiftPreset[]
  safety: SafetyRules
  ruleSeverity: Record<string, RuleSeverity>
  features: FeatureFlags
  scheduleManagers: string[] // staff.id[]
  onboardedAt: string | null
}

/** One roster row — a staff member's scheduling flags for one branch.
 *  Absence of a schedule_members row (schedulable defaults true here) is
 *  the "never explicitly configured" state, not "excluded". */
export type ScheduleStaffRow = {
  staffId: string
  displayName: string
  badge: string | null
  active: boolean
  schedulable: boolean
  defaultRoleId: string | null
  maxWeeklyHours: number | null
  employmentType: string | null
  sortOrder: number | null
  note: string | null
}

export type PublishedSnapshot = { shifts: Shift[]; assignments: Assignment[] }

export type ScheduleWeek = {
  id: string
  branchId: string
  weekStart: ISODate
  status: 'draft' | 'published'
  version: number
  publishedAt: string | null
  dayNotes: Record<string, string>
  dismissedWarnings: string[]
  publishedSnapshot: PublishedSnapshot | null
}

export type Shift = {
  id: string
  branchId: string
  weekId: string
  date: ISODate
  startTime: HM
  endTime: HM
  presetId: string | null
  stationId: string | null
  requirements: RoleRequirement[]
  note: string | null
}

export type AssignmentStatus = 'assigned' | 'swap_pending'

export type Assignment = {
  id: string
  shiftId: string
  staffId: string | null
  staffName: string | null
  roleId: string | null
  status: AssignmentStatus
}

export type AvailabilityKind = 'unavailable' | 'partial' | 'prefer'
export type AvailabilityEntry = { date: ISODate; kind: AvailabilityKind; from?: HM; to?: HM }

export type AvailabilitySubmission = {
  id: string
  staffId: string
  weekStart: ISODate
  entries: AvailabilityEntry[]
  note: string | null
  status: 'draft' | 'submitted'
}

export type SwapStatus = 'open' | 'peer_accepted' | 'approved' | 'rejected' | 'cancelled'

export type SwapRequest = {
  id: string
  assignmentId: string
  fromStaffId: string
  toStaffId: string | null
  status: SwapStatus
  reason: string | null
  decidedAt: string | null
  decisionNote: string | null
}

export type ShiftAuditEntry = {
  id: string
  actorName: string | null
  action: string
  summary: string | null
  detail: Record<string, unknown> | null
  createdAt: string
}

export type WarningSeverity = 'error' | 'warning'

export type Warning = {
  code: string
  severity: WarningSeverity
  message: string
  shiftId?: string
  staffId?: string
}

/** The full window the provider holds: the requested week, ± 1 — enough
 *  for cross-week rest/consecutive-day checks at the boundary. Manager
 *  view reads shifts/assignments live; staff view is built from each
 *  week's publishedSnapshot instead (see serialize.ts). */
export type ShiftsDB = {
  branchId: string
  settings: ShiftSettings
  roster: ScheduleStaffRow[]
  weeks: ScheduleWeek[]
  shifts: Shift[]
  assignments: Assignment[]
  availability: AvailabilitySubmission[]
  swaps: SwapRequest[]
  audit: ShiftAuditEntry[]
  viewerStaffId: string | null
  viewerCanManage: boolean
  viewerCanDelegate: boolean
}
