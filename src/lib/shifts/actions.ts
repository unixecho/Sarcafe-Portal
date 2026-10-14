// One action union, shared between the client provider and the server
// dispatch handler — "one action = one thing that can happen".
//
// There is deliberately no client-side mirror of what an action does: every
// dispatch is a round trip (POST /api/shifts/dispatch, await, then replace state
// with the server's fresh read). All the rules — conflicts, who may approve what,
// what a schedule change does to a pending request — live in the database
// (migration 024) and run exactly once, there. The client only describes intent.
//
// Nothing here carries "who is acting": the server resolves that from the
// session, never from the request body.

import type { HM, ISODate, RoleRequirement, TimeOffKind } from './types'

/** One person on a shift, as the shift sheet's Save sends it. `assignmentId`
 *  present = an existing person being kept (their role may change); absent = a
 *  person being added. An existing assignment that is not listed is removed. */
export type SaveShiftAssignee = { staffId: string; roleId: string | null; assignmentId?: string }

export type ScheduleAction =
  // ---- the manager's board ----
  | {
      type: 'saveShift'
      weekId: string
      /** null/absent = create a new shift. */
      shiftId?: string | null
      date: ISODate
      startTime: HM
      endTime: HM
      presetId?: string | null
      stationId?: string | null
      requirements: RoleRequirement[]
      requestsOpen: boolean
      note?: string | null
      assignees: SaveShiftAssignee[]
      /** The shift's updatedAt as the sheet loaded it — a stale save is refused. */
      expectedUpdatedAt?: string | null
      /** Who does the shift's checklists, picked by the manager among the people on it (null = nobody: the first to send
       *  covers the rest). Absent = leave as it is. Applied right after the save, from the person's final assignment. */
      checklistLeadStaffId?: string | null
    }
  | { type: 'deleteShift'; shiftId: string }
  | { type: 'moveAssignment'; assignmentId: string; toShiftId: string }
  | { type: 'publishWeek'; weekId: string }
  | { type: 'fillWeek'; weekId: string }
  | { type: 'prepareWeek'; weekId: string }
  | { type: 'unpublishWeek'; weekId: string }
  | { type: 'clearWeek'; weekId: string }
  | { type: 'copyWeek'; branchId: string; fromWeekStart: ISODate; toWeekStart: ISODate }
  | { type: 'setDayNote'; weekId: string; date: ISODate; note: string }
  | { type: 'updateSettings'; branchId: string; patch: Record<string, unknown> }
  | { type: 'setMember'; branchId: string; staffId: string; patch: Record<string, unknown> }
  /** The settings screen's Save: every changed setting and every changed person's scheduling flags,
   *  written in one request. Each part is authorised and validated exactly as its single action is. */
  | { type: 'saveDraft'; branchId: string; settings?: Record<string, unknown>; members?: { staffId: string; patch: Record<string, unknown> }[] }
  // ---- an employee ----
  | { type: 'submitAvailability'; branchId: string; weekStart: ISODate; entries: unknown[]; note?: string | null; status: 'draft' | 'submitted' }
  /** The wanted state of one week of days off / shift wishes (see time-off.ts); a date not listed means "nothing". */
  | { type: 'submitTimeOff'; branchId: string; weekStart: ISODate; entries: { date: ISODate; kinds: TimeOffKind[] }[] }
  | { type: 'requestShift'; shiftId: string; note?: string | null }
  | { type: 'cancelRequest'; requestId: string }
  | { type: 'requestSwap'; assignmentId: string; targetStaffId?: string | null; returnAssignmentId?: string | null; reason?: string | null }
  /** Ask the colleague who holds `assignmentId` to hand it to me, nothing offered in return. */
  | { type: 'requestTake'; assignmentId: string; reason?: string | null }
  | { type: 'respondSwap'; swapId: string; accept: boolean }
  | { type: 'cancelSwap'; swapId: string }
  // ---- a manager deciding ----
  | { type: 'decideRequest'; requestId: string; approve: boolean; note?: string | null; force?: boolean }
  | { type: 'decideSwap'; swapId: string; approve: boolean; note?: string | null }
  /** Approve or decline days off (normally one person's days of a week). `force` approves a day the person is already scheduled on. */
  | { type: 'decideTimeOff'; branchId: string; ids: string[]; approve: boolean; note?: string | null; force?: boolean }
  // ---- anyone ----
  | { type: 'markNotificationsRead'; ids?: string[] }

export type ScheduleActionType = ScheduleAction['type']

/** What dispatch hands back — success carries whatever the action produced
 *  (e.g. copyWeek's list of people it had to skip); failure carries words a
 *  person can act on, plus the machine reason and details for the few screens
 *  that react to a specific one (needs_confirmation, conflict, stale). */
export type DispatchResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; message: string; reason: string | null; details: Record<string, unknown> }
