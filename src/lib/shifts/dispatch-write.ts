// Server-only write path. One switch over every ScheduleAction — each case
// resolves the branch a target row belongs to (when the action doesn't
// already carry it), authorizes via requireScheduleManager()/
// requireScheduleViewer() (never trusting the client's own idea of who it
// is), then performs the write via the atomic RPCs from migration 010 or
// a guarded plain table write, mirroring how dispatch-write.ts works in
// AyekaBar (a big switch, RPCs for the operations that need atomicity,
// direct writes for simple CRUD).

import { createServiceRoleClient } from '@/lib/supabase/server'
import { BadRequest, Forbidden, NotFound } from '@/lib/http/errors'
import { requireScheduleManager, requireScheduleViewer } from './guard'
import type { ScheduleAction } from './actions'

type Service = ReturnType<typeof createServiceRoleClient>

async function branchOfShift(service: Service, shiftId: string): Promise<string> {
  const { data } = await service.from('shifts').select('branch_id').eq('id', shiftId).maybeSingle()
  if (!data) throw NotFound('Shift not found.')
  return data.branch_id as string
}

async function branchOfWeek(service: Service, weekId: string): Promise<string> {
  const { data } = await service.from('schedule_weeks').select('branch_id').eq('id', weekId).maybeSingle()
  if (!data) throw NotFound('Week not found.')
  return data.branch_id as string
}

async function branchOfAssignment(service: Service, assignmentId: string): Promise<{ branchId: string; staffId: string | null }> {
  const { data } = await service.from('shift_assignments').select('branch_id, staff_id').eq('id', assignmentId).maybeSingle()
  if (!data) throw NotFound('Assignment not found.')
  return { branchId: data.branch_id as string, staffId: (data.staff_id as string | null) ?? null }
}

async function branchOfSwap(service: Service, swapId: string): Promise<string> {
  const { data } = await service.from('shift_swaps').select('branch_id').eq('id', swapId).maybeSingle()
  if (!data) throw NotFound('Swap not found.')
  return data.branch_id as string
}

export async function performDispatch(action: ScheduleAction): Promise<void> {
  const service = createServiceRoleClient()

  switch (action.type) {
    case 'createShift': {
      const branchId = await branchOfWeek(service, action.weekId)
      await requireScheduleManager(branchId)
      const { error } = await service.from('shifts').insert({
        branch_id: branchId,
        week_id: action.weekId,
        shift_date: action.date,
        start_time: action.startTime,
        end_time: action.endTime,
        preset_id: action.presetId ?? null,
        station_id: action.stationId ?? null,
        requirements: action.requirements ?? [],
        note: action.note ?? null,
      })
      if (error) throw BadRequest('Could not create shift.')
      return
    }

    case 'updateShift': {
      const branchId = await branchOfShift(service, action.shiftId)
      await requireScheduleManager(branchId)
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (action.date !== undefined) patch.shift_date = action.date
      if (action.startTime !== undefined) patch.start_time = action.startTime
      if (action.endTime !== undefined) patch.end_time = action.endTime
      if (action.presetId !== undefined) patch.preset_id = action.presetId
      if (action.stationId !== undefined) patch.station_id = action.stationId
      if (action.requirements !== undefined) patch.requirements = action.requirements
      if (action.note !== undefined) patch.note = action.note
      const { error } = await service.from('shifts').update(patch).eq('id', action.shiftId)
      if (error) throw BadRequest('Could not update shift.')
      return
    }

    case 'deleteShift': {
      const branchId = await branchOfShift(service, action.shiftId)
      await requireScheduleManager(branchId)
      const { error } = await service.from('shifts').delete().eq('id', action.shiftId)
      if (error) throw BadRequest('Could not delete shift.')
      return
    }

    case 'assign': {
      const branchId = await branchOfShift(service, action.shiftId)
      await requireScheduleManager(branchId)
      const { data: staffRow } = await service.from('staff').select('display_name, email').eq('id', action.staffId).maybeSingle()
      const staffName = (staffRow?.display_name as string) || (staffRow?.email as string) || null
      const { error } = await service.from('shift_assignments').insert({
        branch_id: branchId,
        shift_id: action.shiftId,
        staff_id: action.staffId,
        staff_name: staffName,
        role_id: action.roleId,
      })
      if (error) throw BadRequest('Could not assign — this person may already be assigned to this role on this shift.')
      return
    }

    case 'unassign': {
      const { branchId } = await branchOfAssignment(service, action.assignmentId)
      await requireScheduleManager(branchId)
      const { error } = await service.from('shift_assignments').delete().eq('id', action.assignmentId)
      if (error) throw BadRequest('Could not remove assignment.')
      return
    }

    case 'publishWeek': {
      const branchId = await branchOfWeek(service, action.weekId)
      await requireScheduleManager(branchId)
      const { error } = await service.rpc('publish_schedule_week', { p_week_id: action.weekId })
      if (error) throw BadRequest('Could not publish week.')
      return
    }

    case 'unpublishWeek': {
      const branchId = await branchOfWeek(service, action.weekId)
      await requireScheduleManager(branchId)
      const { error } = await service.rpc('unpublish_schedule_week', { p_week_id: action.weekId })
      if (error) throw BadRequest('Could not unpublish week.')
      return
    }

    case 'clearWeek': {
      const branchId = await branchOfWeek(service, action.weekId)
      await requireScheduleManager(branchId)
      const { error } = await service.rpc('clear_schedule_week', { p_week_id: action.weekId })
      if (error) throw BadRequest('Could not clear week.')
      return
    }

    case 'copyWeek': {
      await requireScheduleManager(action.branchId)
      const { error } = await service.rpc('copy_schedule_week', {
        p_branch_id: action.branchId,
        p_from_week_start: action.fromWeekStart,
        p_to_week_start: action.toWeekStart,
      })
      if (error) throw BadRequest('Could not copy week.')
      return
    }

    case 'setDayNote': {
      const branchId = await branchOfWeek(service, action.weekId)
      await requireScheduleManager(branchId)
      const { data: week } = await service.from('schedule_weeks').select('day_notes').eq('id', action.weekId).maybeSingle()
      const dayNotes = { ...((week?.day_notes as Record<string, string>) ?? {}) }
      if (action.note.trim()) dayNotes[action.date] = action.note.trim()
      else delete dayNotes[action.date]
      const { error } = await service.from('schedule_weeks').update({ day_notes: dayNotes, updated_at: new Date().toISOString() }).eq('id', action.weekId)
      if (error) throw BadRequest('Could not save note.')
      return
    }

    case 'updateSettings': {
      await requireScheduleManager(action.branchId)
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      const map: Record<string, string> = {
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
      for (const [key, column] of Object.entries(map)) {
        if (key in action.patch) patch[column] = action.patch[key]
      }
      const { error } = await service.from('shift_settings').update(patch).eq('branch_id', action.branchId)
      if (error) throw BadRequest('Could not save settings.')
      return
    }

    case 'setMember': {
      await requireScheduleManager(action.branchId)
      const { error } = await service.rpc('set_schedule_member', {
        p_branch_id: action.branchId,
        p_staff_id: action.staffId,
        p_patch: action.patch,
      })
      if (error) throw BadRequest('Could not save.')
      return
    }

    case 'submitAvailability': {
      const staff = await requireScheduleViewer(action.branchId)
      const { error } = await service
        .from('shift_availability')
        .upsert(
          {
            branch_id: action.branchId,
            staff_id: staff.id,
            week_start: action.weekStart,
            entries: action.entries,
            note: action.note ?? null,
            status: action.status,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'branch_id,staff_id,week_start' }
        )
      if (error) throw BadRequest('Could not save availability.')
      return
    }

    case 'requestSwap': {
      const { branchId, staffId } = await branchOfAssignment(service, action.assignmentId)
      const staff = await requireScheduleViewer(branchId)
      if (staffId !== staff.id) throw Forbidden('You can only request a swap for your own shift.')
      const { error } = await service.rpc('request_shift_swap', { p_assignment_id: action.assignmentId, p_reason: action.reason ?? null })
      if (error) throw BadRequest('Could not request a swap.')
      return
    }

    case 'acceptSwap': {
      const branchId = await branchOfSwap(service, action.swapId)
      await requireScheduleViewer(branchId)
      const { error } = await service.rpc('accept_shift_swap', { p_swap_id: action.swapId })
      if (error) throw BadRequest('Could not accept this swap.')
      return
    }

    case 'decideSwap': {
      const branchId = await branchOfSwap(service, action.swapId)
      await requireScheduleManager(branchId)
      const { error } = await service.rpc('decide_shift_swap', { p_swap_id: action.swapId, p_approve: action.approve, p_note: action.note ?? null })
      if (error) throw BadRequest('Could not decide this swap.')
      return
    }

    case 'cancelSwap': {
      const branchId = await branchOfSwap(service, action.swapId)
      await requireScheduleViewer(branchId)
      const { error } = await service.rpc('cancel_shift_swap', { p_swap_id: action.swapId })
      if (error) throw BadRequest('Could not cancel this swap.')
      return
    }

    default: {
      const _exhaustive: never = action
      throw BadRequest(`Unknown action: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
