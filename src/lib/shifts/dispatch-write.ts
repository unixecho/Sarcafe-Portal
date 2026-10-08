// Server-only write path. One switch over every ScheduleAction. Each case
//   1. resolves the branch the target row belongs to (never trusting a client's
//      idea of it),
//   2. authorises via requireScheduleManager()/requireScheduleViewer() — the
//      primary gate, resolved from the session, never from the body,
//   3. calls ONE database function (migration 024) with the caller's staff id as
//      the explicit actor. Those functions re-check the same rule, apply the
//      change atomically, enforce the invariants (no double-booking, a pending
//      request never edits the schedule) and write the audit row.
//
// A refusal ({ ok:false, reason }) from the database becomes an ApiError whose
// message is plain Hebrew (lib/shifts/messages.ts) and whose details carry the
// machine reason, so the screen can show the words and react to the few reasons
// it handles specially (needs_confirmation, conflict, stale).

import { createServiceRoleClient } from '@/lib/supabase/server'
import { ApiError, NotFound } from '@/lib/http/errors'
import { requireScheduleDelegator, requireScheduleManager, requireScheduleViewer } from './guard'
import { scheduleMessage, scheduleStatus, type Details } from './messages'
import { requireStaff } from '@/lib/staff/guard'
import { addDays, weekStartOf } from './time'
import type { ScheduleAction } from './actions'
import type { SettingsPatch } from './schema'
import { DEFAULT_PRESETS } from './config'

type Service = ReturnType<typeof createServiceRoleClient>
type Row = Record<string, unknown>

const INTERNAL = 'משהו השתבש אצלנו. נסו שוב בעוד רגע.'

function codeFor(status: number): string {
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limited'
  return 'bad_request'
}

/** A database refusal as the one error shape every route returns. */
export function refusal(reason: string, details: Details = {}): ApiError {
  const status = scheduleStatus(reason)
  return new ApiError(status, codeFor(status), scheduleMessage(reason, details), { reason, ...details })
}

/** Calls one sched_* function and unwraps its { ok, reason, details } result. */
async function callSched(service: Service, fn: string, args: Row): Promise<Row> {
  const { data, error } = await service.rpc(fn, args)
  if (error) {
    // Never forward database text; the log line carries the function, the SQLSTATE and a short message.
    console.error(`schedule rpc ${fn} failed:`, error.code, String(error.message ?? '').slice(0, 200))
    // The deferred constraint trigger is the backstop for a double-booking written around the checks.
    if (/sched_overlap/.test(error.message ?? '')) throw refusal('conflict')
    throw new ApiError(500, 'internal_error', INTERNAL)
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    console.error(`schedule rpc ${fn} returned an unexpected shape`)
    throw new ApiError(500, 'internal_error', INTERNAL)
  }
  const res = data as Row & { ok?: boolean; reason?: string; details?: Details }
  if (res.ok !== true) throw refusal(typeof res.reason === 'string' ? res.reason : 'bad_request', res.details ?? {})
  return res
}

async function branchOfWeek(service: Service, weekId: string): Promise<string> {
  const { data } = await service.from('schedule_weeks').select('branch_id').eq('id', weekId).maybeSingle()
  if (!data) throw NotFound('לא מצאנו את השבוע. רעננו ונסו שוב.')
  return data.branch_id as string
}

async function branchOfShift(service: Service, shiftId: string): Promise<string> {
  const { data } = await service.from('shifts').select('branch_id').eq('id', shiftId).maybeSingle()
  if (!data) throw NotFound('לא מצאנו את המשמרת — ייתכן שנמחקה. רעננו ונסו שוב.')
  return data.branch_id as string
}

async function branchOfAssignment(service: Service, assignmentId: string): Promise<string> {
  const { data } = await service.from('shift_assignments').select('branch_id').eq('id', assignmentId).maybeSingle()
  if (!data) throw NotFound('לא מצאנו את השיבוץ. רעננו ונסו שוב.')
  return data.branch_id as string
}

async function branchOfSwap(service: Service, swapId: string): Promise<string> {
  const { data } = await service.from('shift_swaps').select('branch_id').eq('id', swapId).maybeSingle()
  if (!data) throw NotFound('לא מצאנו את בקשת ההחלפה. רעננו ונסו שוב.')
  return data.branch_id as string
}

async function branchOfRequest(service: Service, requestId: string): Promise<string> {
  const { data } = await service.from('shift_requests').select('branch_id').eq('id', requestId).maybeSingle()
  if (!data) throw NotFound('לא מצאנו את הבקשה. רעננו ונסו שוב.')
  return data.branch_id as string
}

/** The columns a settings patch writes. Delegation (scheduleManagers) is separate: owner/GM only. */
const SETTINGS_COLUMNS: Record<string, string> = {
  workingDays: 'working_days',
  openTime: 'open_time',
  closeTime: 'close_time',
  dayHours: 'day_hours',
  roles: 'roles',
  stations: 'stations',
  presets: 'presets',
  safety: 'safety',
  ruleSeverity: 'rule_severity',
  features: 'features',
}

const SETTINGS_LABELS: Record<string, string> = {
  workingDays: 'ימי פעילות',
  openTime: 'שעות פעילות',
  closeTime: 'שעות פעילות',
  dayHours: 'שעות מותאמות ליום',
  roles: 'תפקידים',
  stations: 'עמדות',
  presets: 'תבניות משמרת',
  safety: 'כללי בטיחות',
  ruleSeverity: 'חומרת התראות',
  features: 'יכולות',
  scheduleManagers: 'אחראי/ות שיבוץ',
}

export async function performDispatch(action: ScheduleAction): Promise<Row> {
  const service = createServiceRoleClient()

  switch (action.type) {
    // ======================================================== the manager's board
    case 'saveShift': {
      const branchId = await branchOfWeek(service, action.weekId)
      const actor = await requireScheduleManager(branchId)
      return callSched(service, 'sched_save_shift', {
        p_actor: actor.id,
        p_week_id: action.weekId,
        p_shift_id: action.shiftId ?? null,
        p_date: action.date,
        p_start: action.startTime,
        p_end: action.endTime,
        p_preset_id: action.presetId ?? null,
        p_station_id: action.stationId ?? null,
        p_requirements: action.requirements,
        p_note: action.note ?? null,
        p_assignees: action.assignees.map((a) => ({ staffId: a.staffId, roleId: a.roleId ?? null, ...(a.assignmentId ? { assignmentId: a.assignmentId } : {}) })),
        p_expected_updated: action.expectedUpdatedAt ?? null,
      })
    }

    case 'deleteShift': {
      const branchId = await branchOfShift(service, action.shiftId)
      const actor = await requireScheduleManager(branchId)
      return callSched(service, 'sched_delete_shift', { p_actor: actor.id, p_shift_id: action.shiftId })
    }

    case 'moveAssignment': {
      const branchId = await branchOfAssignment(service, action.assignmentId)
      const actor = await requireScheduleManager(branchId)
      return callSched(service, 'sched_move_assignment', { p_actor: actor.id, p_assignment: action.assignmentId, p_to_shift: action.toShiftId })
    }

    case 'publishWeek': {
      const branchId = await branchOfWeek(service, action.weekId)
      const actor = await requireScheduleManager(branchId)
      return callSched(service, 'sched_publish_week', { p_actor: actor.id, p_week_id: action.weekId })
    }

    case 'fillWeek': {
      const branchId = await branchOfWeek(service, action.weekId)
      const actor = await requireScheduleManager(branchId)
      return callSched(service, 'sched_fill_week', { p_actor: actor.id, p_week: action.weekId })
    }

    case 'prepareWeek': {
      const branchId = await branchOfWeek(service, action.weekId)
      const actor = await requireScheduleManager(branchId)
      const { data: settings } = await service.from('shift_settings').select('presets').eq('branch_id', branchId).maybeSingle()
      const presets = Array.isArray(settings?.presets) && settings.presets.length ? settings.presets : DEFAULT_PRESETS
      return callSched(service, 'sched_prepare_week', { p_actor: actor.id, p_week: action.weekId, p_presets: presets })
    }

    case 'unpublishWeek': {
      const branchId = await branchOfWeek(service, action.weekId)
      const actor = await requireScheduleManager(branchId)
      return callSched(service, 'sched_unpublish_week', { p_actor: actor.id, p_week_id: action.weekId })
    }

    case 'clearWeek': {
      const branchId = await branchOfWeek(service, action.weekId)
      const actor = await requireScheduleManager(branchId)
      return callSched(service, 'sched_clear_week', { p_actor: actor.id, p_week_id: action.weekId })
    }

    case 'copyWeek': {
      const actor = await requireScheduleManager(action.branchId)
      return callSched(service, 'sched_copy_week', {
        p_actor: actor.id,
        p_branch: action.branchId,
        p_from: weekStartOf(action.fromWeekStart),
        p_to: weekStartOf(action.toWeekStart),
      })
    }

    case 'setDayNote': {
      const branchId = await branchOfWeek(service, action.weekId)
      const actor = await requireScheduleManager(branchId)
      const { data: week } = await service.from('schedule_weeks').select('day_notes, week_start').eq('id', action.weekId).maybeSingle()
      if (!week) throw NotFound('לא מצאנו את השבוע. רעננו ונסו שוב.')
      const start = week.week_start as string
      if (action.date < start || action.date > addDays(start, 6)) throw refusal('bad_date')
      const dayNotes = { ...((week.day_notes as Record<string, string>) ?? {}) }
      const text = action.note.trim()
      if (text) dayNotes[action.date] = text
      else delete dayNotes[action.date]
      const { error } = await service.from('schedule_weeks').update({ day_notes: dayNotes, updated_at: new Date().toISOString() }).eq('id', action.weekId)
      if (error) throw new ApiError(500, 'internal_error', INTERNAL)
      await service.rpc('sched_log', {
        p_branch: branchId,
        p_actor: actor.id,
        p_action: 'schedule.note',
        p_summary: text ? `עדכן/ה הערה ליום ${action.date}: ${text}` : `הסיר/ה הערה מיום ${action.date}`,
        p_detail: { weekId: action.weekId, date: action.date },
      })
      return {}
    }

    case 'updateSettings': {
      const patch = action.patch as SettingsPatch
      const touchesDelegates = 'scheduleManagers' in patch
      // Choosing WHO may manage the schedule is narrower than managing it: a
      // delegate must not be able to promote themselves or anyone else.
      const actor = touchesDelegates ? await requireScheduleDelegator(action.branchId) : await requireScheduleManager(action.branchId)

      const update: Row = { updated_at: new Date().toISOString() }
      for (const [key, column] of Object.entries(SETTINGS_COLUMNS)) {
        if (key in patch) update[column] = (patch as Row)[key]
      }
      if (touchesDelegates) {
        const ids = Array.from(new Set(patch.scheduleManagers ?? []))
        if (ids.length > 0) {
          // Only active people who work in this branch can be given the schedule.
          const { data: found } = await service.from('staff').select('id, branch_id, active').in('id', ids)
          const ok = (found ?? []).filter((s) => s.active && (s.branch_id === null || s.branch_id === action.branchId)).map((s) => s.id as string)
          if (ok.length !== ids.length) throw refusal('wrong_branch')
        }
        update.schedule_managers = ids
      }
      const { error } = await service.from('shift_settings').update(update).eq('branch_id', action.branchId)
      if (error) throw new ApiError(500, 'internal_error', INTERNAL)

      const labels = Array.from(new Set(Object.keys(patch).map((k) => SETTINGS_LABELS[k]).filter(Boolean)))
      await service.rpc('sched_log', {
        p_branch: action.branchId,
        p_actor: actor.id,
        p_action: 'settings.update',
        p_summary: `עדכן/ה הגדרות לוח: ${labels.join(', ')}`,
        p_detail: { keys: Object.keys(patch) },
      })
      return {}
    }

    case 'setMember': {
      const actor = await requireScheduleManager(action.branchId)
      return callSched(service, 'sched_set_member', {
        p_actor: actor.id,
        p_branch: action.branchId,
        p_staff: action.staffId,
        p_patch: action.patch,
      })
    }

    // ============================================================ an employee
    case 'submitAvailability': {
      const staff = await requireScheduleViewer(action.branchId)
      const start = weekStartOf(action.weekStart)
      if (start !== action.weekStart) throw refusal('bad_date')
      const end = addDays(start, 6)
      for (const e of action.entries as { date: string }[]) {
        if (e.date < start || e.date > end) throw refusal('bad_date')
      }
      return callSched(service, 'sched_submit_availability', {
        p_actor: staff.id, p_branch: action.branchId, p_week_start: start,
        p_entries: action.entries, p_note: action.note ?? null, p_status: action.status,
      })
    }

    case 'requestShift': {
      const branchId = await branchOfShift(service, action.shiftId)
      const actor = await requireScheduleViewer(branchId)
      return callSched(service, 'sched_request_shift', { p_actor: actor.id, p_shift: action.shiftId, p_note: action.note ?? null })
    }

    case 'cancelRequest': {
      const branchId = await branchOfRequest(service, action.requestId)
      const actor = await requireScheduleViewer(branchId)
      return callSched(service, 'sched_cancel_request', { p_actor: actor.id, p_request: action.requestId })
    }

    case 'requestSwap': {
      const branchId = await branchOfAssignment(service, action.assignmentId)
      const actor = await requireScheduleViewer(branchId)
      return callSched(service, 'sched_request_swap', {
        p_actor: actor.id,
        p_assignment: action.assignmentId,
        p_target: action.targetStaffId ?? null,
        p_return: action.returnAssignmentId ?? null,
        p_reason: action.reason ?? null,
      })
    }

    case 'respondSwap': {
      const branchId = await branchOfSwap(service, action.swapId)
      const actor = await requireScheduleViewer(branchId)
      return callSched(service, 'sched_respond_swap', { p_actor: actor.id, p_swap: action.swapId, p_accept: action.accept })
    }

    case 'cancelSwap': {
      const branchId = await branchOfSwap(service, action.swapId)
      const actor = await requireScheduleViewer(branchId)
      return callSched(service, 'sched_cancel_swap', { p_actor: actor.id, p_swap: action.swapId })
    }

    // ===================================================== a manager deciding
    case 'decideRequest': {
      const branchId = await branchOfRequest(service, action.requestId)
      const actor = await requireScheduleManager(branchId)
      return callSched(service, 'sched_decide_request', {
        p_actor: actor.id,
        p_request: action.requestId,
        p_approve: action.approve,
        p_note: action.note ?? null,
        p_force: action.force === true,
      })
    }

    case 'decideSwap': {
      const branchId = await branchOfSwap(service, action.swapId)
      const actor = await requireScheduleManager(branchId)
      return callSched(service, 'sched_decide_swap', {
        p_actor: actor.id,
        p_swap: action.swapId,
        p_approve: action.approve,
        p_note: action.note ?? null,
      })
    }

    // ================================================================ anyone
    case 'markNotificationsRead': {
      // Notifications are addressed to a person; any active staff row may clear their OWN.
      const actor = await requireStaff()
      const { error } = await service.rpc('sched_mark_read', { p_actor: actor.id, p_ids: action.ids ?? null })
      if (error) throw new ApiError(500, 'internal_error', INTERNAL)
      return {}
    }

    default: {
      const _exhaustive: never = action
      throw new ApiError(400, 'bad_request', `Unknown action: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
