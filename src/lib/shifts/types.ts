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
/** A shift TEMPLATE: the times offered by default when a shift is created.
 *  It is never consulted again once a shift exists — a shift owns its own
 *  explicit start/end, so editing a template can never move scheduled shifts. */
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
  scheduleManagers: string[] // staff.id[]  (managers only — empty for everyone else)
  onboardedAt: string | null
}

/** One roster row — a person as the scheduler sees them. `displayName` is ALWAYS
 *  a real name (lib/shifts/names.ts), never blank, whether or not the person has
 *  an email. The scheduling fields after `active` are the manager's private
 *  bookkeeping: they are null/false for any non-manager viewer. */
export type ScheduleStaffRow = {
  staffId: string
  displayName: string
  badge: string | null
  active: boolean
  /** Absence of a schedule_members row means "never configured" = schedulable. */
  schedulable: boolean
  defaultRoleId: string | null
  maxWeeklyHours: number | null
  employmentType: string | null
  sortOrder: number | null
  note: string | null
  /** Has a linked sign-in — i.e. can open the app, see their schedule and answer a swap. */
  hasLogin: boolean
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
  /** Raw timestamp string, echoed back on save so a concurrent edit is detected. */
  updatedAt: string | null
}

/** `swap_pending` is legacy (migration 024 stopped writing it): a pending swap is
 *  derived from the swaps list and never alters the assignment itself. */
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

// ---- Swaps ------------------------------------------------------------------
//   open ──(colleague accepts)──> peer_accepted ──(manager approves)──> approved
//     │  \──(named colleague declines)──> declined   └─(manager rejects)──> rejected
//     └──(requester / manager / a schedule change)──> cancelled
export type SwapStatus = 'open' | 'peer_accepted' | 'approved' | 'rejected' | 'declined' | 'cancelled'

/** What one side of a swap looked like when it was agreed. Kept on the swap
 *  itself so the record stays readable after the shifts are edited or deleted. */
export type SwapSide = {
  assignmentId: string
  shiftId: string
  weekId: string
  date: ISODate
  start: HM
  end: HM
  presetId: string | null
  roleId: string | null
  staffId: string | null
  staffName: string | null
  label: string
}

export type SwapRequest = {
  id: string
  /** null once the underlying assignment is gone (history survives). */
  assignmentId: string | null
  /** The shift the other person gives in return (an exchange); null = a hand-over. */
  returnAssignmentId: string | null
  fromStaffId: string
  fromStaffName: string | null
  toStaffId: string | null
  toStaffName: string | null
  status: SwapStatus
  reason: string | null
  cancelReason: string | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
  terms: { from?: SwapSide; to?: SwapSide | null }
}

// ---- "I would like to work this shift" ----------------------------------------
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export type ShiftRequest = {
  id: string
  shiftId: string | null
  staffId: string
  staffName: string | null
  status: RequestStatus
  note: string | null
  decisionNote: string | null
  cancelReason: string | null
  decidedAt: string | null
  createdAt: string
  terms: { shiftId?: string; weekId?: string; date?: ISODate; start?: HM; end?: HM; label?: string }
}

// ---- In-app notifications (nothing here depends on email) ----------------------
export type NotificationLink = { tab?: 'schedule' | 'requests'; weekStart?: ISODate; shiftId?: string }

export type ScheduleNotification = {
  id: string
  kind: string
  title: string
  body: string | null
  link: NotificationLink
  createdAt: string
  readAt: string | null
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

/** The branch's own wall clock right now — the one thing "has this shift
 *  already started?" is decided by, on the server and (from this) the client. */
export type WallClock = { date: ISODate; time: HM }

/** Shift choices offered before publishing, deliberately without names, notes or assignments. */
export type PlanningShift = Pick<Shift, 'id' | 'weekId' | 'date' | 'startTime' | 'endTime' | 'presetId'>
export type SaturdayBalance = { staffId: string; minutes: number; shifts: number }

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
  requests: ShiftRequest[]
  planningShifts: PlanningShift[]
  /** Manager-only count of scheduled Saturday opportunities in the preceding 12 weeks. */
  saturdayBalance: SaturdayBalance[]
  notifications: ScheduleNotification[]
  unreadCount: number
  audit: ShiftAuditEntry[]
  now: WallClock
  viewerStaffId: string | null
  viewerCanManage: boolean
  viewerCanDelegate: boolean
}
