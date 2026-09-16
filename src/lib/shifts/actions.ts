// One action union, shared between the client provider and the server
// dispatch handler — the same "one action = one thing that can happen"
// shape AyekaBar's lib/shifts/store.ts uses. Simplified from AyekaBar's
// own architecture in one real way: there is no client-side pure reducer
// mirroring these into an optimistic local apply. Every dispatch is a
// round trip (POST /api/shifts/dispatch, await, replace state with the
// server's fresh read) — a deliberate trade of a little perceived latency
// for not needing two implementations of "what does this action do" to
// stay in sync with zero live Supabase project to test that against.
// ShiftsProvider still applies a lightweight instant UI update for the
// one interaction that benefits most from feeling instant (a switch-style
// toggle); everything else waits for the real response.

import type { HM, ISODate, RoleRequirement } from './types'

export type ScheduleAction =
  | { type: 'createShift'; weekId: string; date: ISODate; startTime: HM; endTime: HM; presetId?: string | null; stationId?: string | null; requirements?: RoleRequirement[]; note?: string | null }
  | { type: 'updateShift'; shiftId: string; date?: ISODate; startTime?: HM; endTime?: HM; presetId?: string | null; stationId?: string | null; requirements?: RoleRequirement[]; note?: string | null }
  | { type: 'deleteShift'; shiftId: string }
  | { type: 'assign'; shiftId: string; staffId: string; roleId: string | null }
  | { type: 'unassign'; assignmentId: string }
  | { type: 'publishWeek'; weekId: string }
  | { type: 'unpublishWeek'; weekId: string }
  | { type: 'clearWeek'; weekId: string }
  | { type: 'copyWeek'; branchId: string; fromWeekStart: ISODate; toWeekStart: ISODate }
  | { type: 'setDayNote'; weekId: string; date: ISODate; note: string }
  | { type: 'updateSettings'; branchId: string; patch: Record<string, unknown> }
  | { type: 'setMember'; branchId: string; staffId: string; patch: Record<string, unknown> }
  | { type: 'submitAvailability'; branchId: string; weekStart: ISODate; entries: unknown[]; note?: string | null; status: 'draft' | 'submitted' }
  | { type: 'requestSwap'; assignmentId: string; reason?: string | null }
  | { type: 'acceptSwap'; swapId: string }
  | { type: 'decideSwap'; swapId: string; approve: boolean; note?: string | null }
  | { type: 'cancelSwap'; swapId: string }

export type ScheduleActionType = ScheduleAction['type']
