import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { ensureVapidConfigured } from '@/lib/push/send'

// The developer's health check (/staff/dev, "מפתח" view). Read-only, on every load. A migration is judged by the OBJECT it
// creates (a table answers, a column answers), never by the migrations list, which is not what ran: several of this
// project's migrations were run by hand in the SQL editor.

export type HealthRow = { id: string; label: string; state: 'ok' | 'warn' | 'bad' | 'info'; detail: string }

type Service = ReturnType<typeof createServiceRoleClient>

const PROBES: { id: string; label: string; migration: string; table: string; column?: string }[] = [
  { id: 'time-off', label: 'ימי חופש ואילוצים', migration: '20261015091000', table: 'staff_time_off' },
  { id: 'single-responsible', label: 'אחראי/ת לצ׳קליסטים במשמרת', migration: '20261015090000', table: 'shift_assignments', column: 'checklist_lead' },
  { id: 'issue-resolutions', label: 'חוסרים ופערים: סימון כטופל', migration: '20261015092000', table: 'checklist_issue_resolutions' },
  { id: 'branch-checklists', label: 'צ׳קליסטים לפי סניף (הפעלה וכיבוי)', migration: '20261016090000', table: 'checklist_branch_settings' },
  { id: 'push-subs', label: 'מכשירים להתראות', migration: '20261012120000', table: 'staff_push_subscriptions' },
  { id: 'push-outbox', label: 'תור ההתראות לטלפון', migration: '20261012120000', table: 'schedule_notifications', column: 'push_sent_at' },
  { id: 'onboarding-progress', label: 'התקדמות הצטרפות עובדים והיתר כניסה בלי התראות', migration: '20261016140000', table: 'staff', column: 'onboarding_done_at' },
  { id: 'event-parent', label: 'קופות אירועים לפי סניף', migration: '20261016140000', table: 'branches', column: 'parent_branch_id' },
]

async function probe(service: Service, table: string, column?: string): Promise<string | null> {
  const { error } = await service.from(table).select(column ?? '*', { head: true, count: 'exact' }).limit(1)
  return error ? `${error.code ?? ''} ${String(error.message ?? '').slice(0, 90)}`.trim() : null
}

export async function readDevHealth(): Promise<HealthRow[]> {
  const service = createServiceRoleClient()
  const rows: HealthRow[] = []

  const results = await Promise.all(PROBES.map((p) => probe(service, p.table, p.column).catch((e) => String(e?.message ?? e).slice(0, 90))))
  PROBES.forEach((p, i) => {
    const problem = results[i]
    rows.push(problem === null
      ? { id: p.id, label: p.label, state: 'ok', detail: `קיים (מיגרציה ${p.migration})` }
      : { id: p.id, label: p.label, state: 'bad', detail: `לא נמצא — צריך להריץ את מיגרציה ${p.migration}. (${problem})` })
  })

  // The scheduler that writes the timed alerts and pushes them.
  const cron = await service.rpc('staff_push_cron_status')
  const status = cron.error ? null : (cron.data as { available?: boolean; scheduled?: boolean; active?: boolean; lastRunAt?: string | null; lastRunStatus?: string | null; lastHttpStatus?: number | null; lastHttpError?: string | null } | null)
  if (!status || status.available === false) rows.push({ id: 'cron', label: 'מתזמן ההתראות (כל 2 דקות)', state: 'warn', detail: 'לא ניתן לקרוא את מצבו. ייתכן שההרחבות של Supabase אינן זמינות.' })
  else if (!status.scheduled || status.active === false) rows.push({ id: 'cron', label: 'מתזמן ההתראות (כל 2 דקות)', state: 'bad', detail: 'המשימה staff-push לא מתוזמנת או כבויה, ולכן לא יישלחו תזכורות.' })
  else {
    const minutesAgo = status.lastRunAt ? Math.round((Date.now() - Date.parse(status.lastRunAt)) / 60000) : null
    const stale = minutesAgo === null || minutesAgo > 10
    const httpBad = status.lastHttpStatus !== null && status.lastHttpStatus !== undefined && status.lastHttpStatus !== 200
    rows.push({
      id: 'cron', label: 'מתזמן ההתראות (כל 2 דקות)', state: stale || httpBad ? 'bad' : 'ok',
      detail: minutesAgo === null ? 'עוד לא רץ.' : `רץ לפני ${minutesAgo} דקות (${status.lastRunStatus ?? '—'}) · תשובת האתר ${status.lastHttpStatus ?? '—'}${status.lastHttpError ? ` · ${status.lastHttpError}` : ''}`,
    })
  }

  rows.push({ id: 'vapid', label: 'מפתחות התראות (VAPID)', state: ensureVapidConfigured() ? 'ok' : 'bad', detail: ensureVapidConfigured() ? 'מוגדרים.' : 'חסרים בשרת — לא יישלחו התראות לטלפון.' })
  rows.push({ id: 'cron-secret', label: 'סוד המתזמן (CRON_SECRET)', state: process.env.CRON_SECRET ? 'ok' : 'warn', detail: process.env.CRON_SECRET ? 'מוגדר.' : 'לא מוגדר בשרת הזה — המתזמן של Supabase לא יצליח לקרוא לאתר.' })

  // How many people can actually be reached by a push, and how many alerts wait to be sent.
  const [people, devices, waiting] = await Promise.all([
    service.from('staff').select('id', { count: 'exact', head: true }).eq('active', true),
    service.from('staff_push_subscriptions').select('staff_id'),
    service.from('schedule_notifications').select('id', { count: 'exact', head: true }).is('push_sent_at', null),
  ])
  if (!people.error && !devices.error) {
    const reachable = new Set((devices.data ?? []).map((row) => row.staff_id as string)).size
    rows.push({ id: 'reach', label: 'עובדים שמקבלים התראות לטלפון', state: 'info', detail: `${reachable} מתוך ${people.count ?? 0} עובדים פעילים.` })
  }
  if (!waiting.error) rows.push({ id: 'backlog', label: 'התראות שמחכות לשליחה', state: (waiting.count ?? 0) > 20 ? 'warn' : 'info', detail: `${waiting.count ?? 0}.` })

  // Every permanent branch needs hours and at least one checklist form to run a day.
  const { data: branches } = await service.from('branches').select('id, slug, name, kind').eq('active', true)
  for (const branch of (branches ?? []).filter((b) => b.kind !== 'event')) {
    const [settings, templates] = await Promise.all([
      service.from('shift_settings').select('presets, open_time, close_time').eq('branch_id', branch.id).maybeSingle(),
      service.from('checklist_templates').select('kind').eq('branch_id', branch.id).eq('active', true),
    ])
    const hasSettings = Boolean(settings.data)
    const forms = (templates.data ?? []).length
    rows.push({
      id: `branch-${branch.slug as string}`, label: `סניף: ${(branch.name as { he?: string } | null)?.he ?? branch.slug}`,
      state: hasSettings && forms === 3 ? 'ok' : 'warn',
      detail: `${hasSettings ? 'הגדרות סידור קיימות' : 'אין הגדרות סידור'} · ${forms}/3 טפסי צ׳קליסט פעילים.`,
    })
  }
  return rows
}
