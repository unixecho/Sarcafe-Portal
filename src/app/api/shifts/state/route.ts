import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { requireScheduleViewer } from '@/lib/shifts/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { canDelegateSchedule, canManageSchedule } from '@/lib/shifts/access'
import { loadShiftsState } from '@/lib/shifts/state-query'

const WEEK_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// The single read endpoint for both owner/manager and staff self-service
// views — RLS-equivalent narrowing happens inside loadShiftsState() based
// on isManager, not by having two routes.
export const GET = apiRoute(async (request: NextRequest) => {
  const branchSlug = request.nextUrl.searchParams.get('branch')
  const week = request.nextUrl.searchParams.get('week')
  if (!branchSlug) throw BadRequest('Unknown or missing branch.')
  if (!week || !WEEK_PATTERN.test(week)) throw BadRequest('Invalid or missing week.')

  const service = createServiceRoleClient()
  const { data: branch } = await service.from('branches').select('id').eq('slug', branchSlug).maybeSingle()
  if (!branch) throw NotFound('Branch not found.')

  const viewer = await requireScheduleViewer(branch.id)

  const { data: settings } = await service.from('shift_settings').select('schedule_managers').eq('branch_id', branch.id).maybeSingle()
  const scheduleManagers = (settings?.schedule_managers as string[]) ?? []
  const isManager = canManageSchedule(viewer, branch.id, scheduleManagers)
  const canDelegate = canDelegateSchedule(viewer, branch.id)

  const db = await loadShiftsState(branch.id, week, viewer, isManager, canDelegate)
  return NextResponse.json({ db })
})
