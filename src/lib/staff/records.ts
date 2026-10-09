import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { ApiError, NotFound, apiRoute } from '@/lib/http/errors'
import type { StaffRecords } from './records-types'

export const PAYSLIP_BUCKET = 'staff-payslips'
export const PAYSLIP_LIMIT = 4 * 1024 * 1024
export const STAFF_PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' }

/** Failed private reads and upload errors must be as uncacheable as success. */
export function privateStaffRoute<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  const wrapped = apiRoute(handler)
  return async (...args: Args) => {
    const response = await wrapped(...args)
    Object.entries(STAFF_PRIVATE_HEADERS).forEach(([name, value]) => response.headers.set(name, value))
    return response
  }
}

/** Reads frozen published assignments, never a manager's current draft. */
export async function loadStaffRecords(staffId: string, canReadPayslips: boolean): Promise<StaffRecords> {
  const service = createServiceRoleClient()
  const [person, weeks, checklists, orders, documents, branches] = await Promise.all([
    service.from('staff').select('id, first_name, last_name, display_name, employee_no, employee_code, email, active').eq('id', staffId).maybeSingle(),
    service.from('schedule_weeks').select('id, branch_id, published_snapshot').not('published_snapshot', 'is', null).order('week_start', { ascending: false }).limit(104),
    service.from('checklist_assignments').select('id, checklist_kind, status, issue_count, submitted_at, created_at, issues').eq('staff_id', staffId).order('created_at', { ascending: false }).limit(100),
    service.from('pos_orders').select('id, ticket_no, total_agorot, status, created_at').eq('created_by', staffId).order('created_at', { ascending: false }).limit(100),
    canReadPayslips ? service.from('staff_payslips').select('id, pay_month, file_name, byte_size, uploaded_at').eq('staff_id', staffId).order('pay_month', { ascending: false }).order('uploaded_at', { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    service.from('branches').select('id, name, slug'),
  ])
  if ([person, weeks, checklists, orders, documents, branches].some((r) => r.error)) throw new ApiError(503, 'unavailable', 'לא הצלחנו לטעון את תיק העובד. נסו שוב.')
  if (!person.data) throw NotFound('העובד לא נמצא')
  const names = new Map((branches.data ?? []).map((b) => [b.id, b.name?.he || b.slug]))
  const history: StaffRecords['shifts'] = []
  for (const week of weeks.data ?? []) {
    const snapshot = week.published_snapshot as { shifts?: Record<string, unknown>[]; assignments?: Record<string, unknown>[] } | null
    const shiftsById = new Map((snapshot?.shifts ?? []).map((s) => [String(s.id), s]))
    for (const assignment of snapshot?.assignments ?? []) {
      if (assignment.staff_id !== staffId) continue
      const shift = shiftsById.get(String(assignment.shift_id))
      if (!shift) continue
      history.push({ id: String(assignment.id), date: String(shift.shift_date), start: String(shift.start_time).slice(0, 5), end: String(shift.end_time).slice(0, 5), label: String(shift.label || 'משמרת'), branch: names.get(week.branch_id) || 'סניף' })
    }
  }
  history.sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start))
  return {
    employee: { ...person.data, employee_no: person.data.employee_code ?? (person.data.employee_no == null ? null : String(person.data.employee_no)) },
    shifts: history.slice(0, 150),
    checklists: (checklists.data ?? []).map(({ checklist_kind, ...row }) => ({ ...row, kind: checklist_kind })),
    orders: orders.data ?? [], payslips: documents.data ?? [], canReadPayslips,
  }
}
