import 'server-only'
import type { createServiceRoleClient } from '@/lib/supabase/server'
import { staffDisplayName } from '@/lib/shifts/names'
import { addDays, wallClockNow, weekStartOf } from '@/lib/shifts/time'
import { unreachableAmong, unreachableKey, unreachableNotice } from '@/lib/shifts/reach'

type Service = ReturnType<typeof createServiceRoleClient>

/** How far ahead the owner is warned about: this week and next. */
const LOOKAHEAD_DAYS = 13

/**
 * The owner's "people on the schedule who will not get alerts" notification. Run when an owner's notification list is
 * read (i.e. whenever they open the app), it writes ONE notification per distinct set of such people for the week, so
 * the list shows it as new when it changes and never repeats itself. Push is marked as already sent: the owner is
 * looking at the app when it is written. Failure is silent: the notification list must load regardless.
 */
export async function ensureUnreachableNotice(service: Service, ownerStaffId: string): Promise<void> {
  try {
    const today = wallClockNow('Asia/Jerusalem').date
    const { data: shifts } = await service.from('shifts').select('id, branch_id').gte('shift_date', today).lte('shift_date', addDays(today, LOOKAHEAD_DAYS)).limit(2000)
    if (!shifts?.length) return
    const { data: assignments } = await service.from('shift_assignments').select('staff_id, shift_id').in('shift_id', shifts.map((s) => s.id as string))
    const staffIds = [...new Set((assignments ?? []).map((a) => a.staff_id as string | null).filter((id): id is string => !!id))]
    if (staffIds.length === 0) return
    const [{ data: staff }, { data: push }] = await Promise.all([
      service.from('staff').select('id, display_name, first_name, last_name, handle, email, active, auth_user_id').in('id', staffIds),
      service.from('staff_push_subscriptions').select('staff_id').in('staff_id', staffIds),
    ])
    const pushOn = new Set((push ?? []).map((p) => p.staff_id as string))
    const roster = (staff ?? []).map((s) => ({
      staffId: s.id as string,
      displayName: staffDisplayName(s as Parameters<typeof staffDisplayName>[0]),
      active: s.active !== false,
      hasLogin: s.auth_user_id != null,
      hasPush: pushOn.has(s.id as string),
    }))
    const people = unreachableAmong(roster, staffIds)
    if (people.length === 0) return
    const firstShiftOf = new Map((assignments ?? []).map((a) => [a.staff_id as string, a.shift_id as string]))
    const branchId = (shifts.find((s) => s.id === firstShiftOf.get(people[0]!.staffId)) ?? shifts[0]!).branch_id as string
    const { title, body } = unreachableNotice(people)
    const now = new Date().toISOString()
    await service.from('schedule_notifications').upsert(
      {
        branch_id: branchId,
        staff_id: ownerStaffId,
        kind: 'schedule.unreachable',
        title,
        body,
        link: { url: '/owner/schedule' },
        dedupe_key: unreachableKey(weekStartOf(today), people),
        push_sent_at: now,
      },
      { onConflict: 'staff_id,dedupe_key', ignoreDuplicates: true }
    )
  } catch {
    /* the list loads without it */
  }
}
