import 'server-only'

// The developer's notification test bench ("test notifications on myself").
//
// A template does not call the push service directly: it writes a real inbox row for the developer
// and flushes, so what is exercised is the production road end to end (inbox -> outbox claim ->
// web push -> service worker -> tap target). Rows are stamped as read so they never inflate the
// developer's unread badge, and titled "(בדיקה)" so nobody mistakes them for real alerts.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { isChecklistDeveloper } from '@/lib/checklists/developer'
import { ensureVapidConfigured } from './send'
import { flushStaffPush } from './staff'

type Service = ReturnType<typeof createServiceRoleClient>
type Me = { id: string; badge?: string | null; email?: string | null; branch_id?: string | null }

/** Same rule the checklist test mode uses: the developer badge, or an allow-listed email. */
export function isPushDeveloper(me: { badge?: string | null; email?: string | null } | null | undefined): boolean {
  return !!me && (me.badge === 'developer' || isChecklistDeveloper(me.email))
}

type Template = { kind: string; title: string; body: string; url: string }
const TEMPLATES: Record<string, Template[]> = {
  schedule: [{ kind: 'schedule.published', title: 'הסידור פורסם (בדיקה)', body: 'הסידור לשבוע הקרוב פורסם. כדאי לבדוק את המשמרות שלך.', url: '/staff/schedule' }],
  shift_eve: [{ kind: 'shift.eve', title: 'מחר יש לך משמרת (בדיקה)', body: 'מאור · 07:30–13:00', url: '/staff/schedule' }],
  shift_today: [{ kind: 'shift.today', title: 'היום יש לך משמרת (בדיקה)', body: 'מאור · 16:30–18:30', url: '/staff/schedule' }],
  checklist_soon: [{ kind: 'checklist.soon', title: 'המשמרת מתחילה בעוד כרבע שעה (בדיקה)', body: 'מחכה לך צ׳קליסט: החלפת משמרת + סגירה · מאור · 16:30', url: '/staff/checklists' }],
  requests_open: [{ kind: 'requests.open', title: 'בקשות לשבוע — אפשר להגיש (בדיקה)', body: 'שבוע 18/10–24/10. אפשר להגיש בקשות וזמינות עד יום שלישי 13/10.', url: '/staff/schedule' }],
  requests_closing: [{ kind: 'requests.closing', title: 'מחר נסגרות הבקשות לשבוע (בדיקה)', body: 'מחר, יום שלישי 13/10, נסגרת ההגשה לשבוע 18/10–24/10.', url: '/staff/schedule' }],
  checklist_late: [{ kind: 'checklist.late', title: 'הצ׳קליסט עוד לא הוגש (בדיקה)', body: 'סגירה · מאור. אפשר להגיש עכשיו.', url: '/staff/checklists' }],
  checklist_gap: [{ kind: 'checklist.gap', title: 'צ׳קליסט לא הוגש (בדיקה)', body: 'דנה · סגירה · מאור', url: '/owner/checklists' }],
  open_shift: [{ kind: 'swap.open', title: 'דנה מוסר/ת משמרת (בדיקה)', body: 'יום ג׳ 07:30–13:00\nמי שפנוי/ה יכול/ה לקחת אותה בלשונית הבקשות.', url: '/staff/schedule' }],
  swap_request: [{ kind: 'swap.request', title: 'דנה מבקש/ת להחליף איתך משמרת (בדיקה)', body: 'יום ד׳ 13:00–19:00 מול יום ה׳ 07:30–13:00', url: '/staff/schedule' }],
  // More than three at once: the phone gets one summary instead of a burst.
  digest: [
    { kind: 'schedule.published', title: 'הסידור פורסם (בדיקה)', body: '', url: '/staff/schedule' },
    { kind: 'shift.eve', title: 'מחר יש לך משמרת (בדיקה)', body: '', url: '/staff/schedule' },
    { kind: 'checklist.late', title: 'הצ׳קליסט עוד לא הוגש (בדיקה)', body: '', url: '/staff/checklists' },
    { kind: 'swap.open', title: 'דנה מוסר/ת משמרת (בדיקה)', body: '', url: '/staff/schedule' },
  ],
}
export const DEV_TEMPLATE_IDS = Object.keys(TEMPLATES) as [string, ...string[]]

export async function devPushStatus(service: Service, me: Me) {
  const [devices, unsent, cron, recent] = await Promise.all([
    service.from('staff_push_subscriptions').select('user_agent, created_at, last_seen_at').eq('staff_id', me.id).order('created_at', { ascending: false }),
    service.from('schedule_notifications').select('id', { count: 'exact', head: true }).is('push_sent_at', null),
    service.rpc('staff_push_cron_status'),
    // The last alerts written for this developer and what the push service said about each (see PushOutcome in staff.ts).
    service.from('schedule_notifications').select('kind, created_at, push_sent_at, link').eq('staff_id', me.id).order('created_at', { ascending: false }).limit(8),
  ])
  return {
    vapidConfigured: ensureVapidConfigured(),
    devices: (devices.data ?? []).map((d) => ({ userAgent: (d.user_agent as string | null) ?? '', createdAt: d.created_at as string, lastSeenAt: d.last_seen_at as string })),
    waiting: unsent.count ?? 0,
    recent: (recent.data ?? []).map((row) => ({
      kind: row.kind as string,
      createdAt: row.created_at as string,
      pushedAt: (row.push_sent_at as string | null) ?? null,
      push: ((row.link as { push?: unknown } | null)?.push ?? null) as { devices: number; accepted: number; refused: { status: number | null; detail: string }[] } | null,
    })),
    cron: cron.error ? { available: false } : (cron.data as Record<string, unknown>),
  }
}

export async function devSendTemplate(service: Service, me: Me, template: string): Promise<{ inserted: number; claimed: number; sent: number; devices: number }> {
  const rows = TEMPLATES[template]
  if (!rows) return { inserted: 0, claimed: 0, sent: 0, devices: 0 }
  let branchId = me.branch_id ?? null
  if (!branchId) {
    const { data } = await service.from('branches').select('id').limit(1).maybeSingle()
    branchId = (data?.id as string | undefined) ?? null
  }
  if (!branchId) return { inserted: 0, claimed: 0, sent: 0, devices: 0 }

  const now = new Date().toISOString()
  const { data: inserted, error } = await service
    .from('schedule_notifications')
    .insert(rows.map((row) => ({ branch_id: branchId, staff_id: me.id, kind: row.kind, title: row.title, body: row.body, link: { url: row.url }, read_at: now })))
    .select('id')
  if (error) throw error
  const { count } = await service.from('staff_push_subscriptions').select('id', { count: 'exact', head: true }).eq('staff_id', me.id)
  const push = await flushStaffPush()
  return { inserted: inserted?.length ?? 0, claimed: push.claimed, sent: push.sent, devices: count ?? 0 }
}
