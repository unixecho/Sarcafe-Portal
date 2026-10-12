// Checks for staff push notifications: the pure timing/routing rules (the real TypeScript, transpiled)
// and the wiring that must not drift (who may subscribe, what the service worker does, where the
// card is mounted, that no sub-daily cron breaks the Hobby deploy).
//
//   node scripts/check-staff-push.mjs

import ts from 'typescript'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
let pass = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const section = (t) => console.log(`\n${t}`)

const dir = mkdtempSync(join(tmpdir(), 'check-staff-push-'))
process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* temp dir */
  }
})
const out = ts.transpileModule(read('src/lib/push/staff-rules.ts'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
writeFileSync(join(dir, 'rules.mjs'), out)
const R = await import(pathToFileURL(join(dir, 'rules.mjs')).href)

section('when a checklist falls due')
const closing = { kind: 'closing', date: '2026-10-12', startTime: '13:00', endTime: '19:00' }
check('closing is not due before the shift ends', R.minutesPastDue(closing, { date: '2026-10-12', time: '18:59' }) < 0)
check('closing is due 10 minutes after the shift ends', R.minutesPastDue(closing, { date: '2026-10-12', time: '19:10' }) === 0)
check('…and counts up from there', R.minutesPastDue(closing, { date: '2026-10-12', time: '19:50' }) === 40)
const night = { kind: 'closing', date: '2026-10-12', startTime: '18:00', endTime: '02:00' }
check('a shift that runs past midnight is due the NEXT day, not at 02:10 today', R.minutesPastDue(night, { date: '2026-10-12', time: '23:00' }) < 0 && R.minutesPastDue(night, { date: '2026-10-13', time: '02:10' }) === 0)
const opening = { kind: 'opening', date: '2026-10-12', startTime: '07:30', endTime: '13:00' }
check('opening is due an hour after the shift STARTS', R.minutesPastDue(opening, { date: '2026-10-12', time: '08:29' }) < 0 && R.minutesPastDue(opening, { date: '2026-10-12', time: '08:30' }) === 0)
const departing = { kind: 'handover', date: '2026-10-12', startTime: '07:30', endTime: '13:00', shiftHasOpening: true }
check('the handover of the employee who also opens is due after their shift ENDS', R.minutesPastDue(departing, { date: '2026-10-12', time: '13:09' }) < 0 && R.minutesPastDue(departing, { date: '2026-10-12', time: '13:10' }) === 0)
const arriving = { kind: 'handover', date: '2026-10-12', startTime: '13:00', endTime: '19:00', shiftHasOpening: false }
check('the handover of the evening employee (no opening on their shift) is due an hour after their shift STARTS', R.minutesPastDue(arriving, { date: '2026-10-12', time: '13:59' }) < 0 && R.minutesPastDue(arriving, { date: '2026-10-12', time: '14:00' }) === 0)
check('a handover with no hint about the shift is treated as the arriving side (1 h after the start)',R.minutesPastDue({ ...closing, kind: 'handover' }, { date: '2026-10-12', time: '14:00' }) === 0)
check('closing stays an end-of-shift checklist whatever else is on the shift', R.minutesPastDue({ ...closing, shiftHasOpening: false }, { date: '2026-10-12', time: '19:10' }) === 0)
check('a shift from yesterday is a full day overdue (the caller cuts it off at the reminder window)', R.minutesPastDue(closing, { date: '2026-10-13', time: '19:10' }) === 24 * 60)
check('owners and developers are told when the checklist becomes due, inside the reminder window', R.OWNER_ESCALATION_MINUTES === 0 && R.OWNER_ESCALATION_MINUTES < R.REMINDER_WINDOW_MINUTES)
check('the evening-shift report (a 13:00-19:00 shift, now 21:20) is still inside the reminder window', R.minutesPastDue({ ...closing, shiftHasOpening: false }, { date: '2026-10-12', time: '21:20' }) <= R.REMINDER_WINDOW_MINUTES)

section('15 minutes before the shift')
const evening = { date: '2026-10-12', startTime: '16:30', endTime: '18:30' }
check('not yet at 16:14', !R.isPreShift(evening, { date: '2026-10-12', time: '16:14' }))
check('on from 16:15 until the shift starts', R.isPreShift(evening, { date: '2026-10-12', time: '16:15' }) && R.isPreShift(evening, { date: '2026-10-12', time: '16:29' }))
check('over once the shift has started', !R.isPreShift(evening, { date: '2026-10-12', time: '16:30' }))
check('a shift at 00:10 is announced from 23:55 the day before', R.isPreShift({ date: '2026-10-13', startTime: '00:10' }, { date: '2026-10-12', time: '23:55' }))

section('your shift tomorrow / today')
const sh = { date: '2026-10-13', startTime: '07:00', endTime: '13:00' }
check('tomorrow\'s shift: nothing before 19:00', R.shiftReminderPhase(sh, { date: '2026-10-12', time: '18:59' }) === null)
check('tomorrow\'s shift: "eve" from 19:00', R.shiftReminderPhase(sh, { date: '2026-10-12', time: '19:00' }) === 'eve' && R.shiftReminderPhase(sh, { date: '2026-10-12', time: '20:30' }) === 'eve')
check('"eve" is dropped after its window (a scheduler outage does not send it at midnight)', R.shiftReminderPhase(sh, { date: '2026-10-12', time: '23:30' }) === null)
check('today: nothing before 07:00', R.shiftReminderPhase(sh, { date: '2026-10-13', time: '06:59' }) === null)
check('today: "today" from 07:00', R.shiftReminderPhase(sh, { date: '2026-10-13', time: '07:00' }) === 'today')
check('today: not for a shift that is already over', R.shiftReminderPhase({ date: '2026-10-13', startTime: '07:00', endTime: '09:00' }, { date: '2026-10-13', time: '09:30' }) === null)
check('a shift two days away gets nothing yet', R.shiftReminderPhase({ ...sh, date: '2026-10-14' }, { date: '2026-10-12', time: '19:30' }) === null)

section('requests for the week')
check('Sunday 10:00 → "open" for the following Sunday, closing Tuesday', JSON.stringify(R.requestsReminder({ date: '2026-10-11', time: '10:00' })) === JSON.stringify({ phase: 'open', targetWeek: '2026-10-18', closeDate: '2026-10-13' }))
check('Monday 10:00 → "closing" tomorrow (Tuesday)', JSON.stringify(R.requestsReminder({ date: '2026-10-12', time: '10:00' })) === JSON.stringify({ phase: 'closing', targetWeek: '2026-10-18', closeDate: '2026-10-13' }))
check('nothing before 10:00, after the window, or on other days', R.requestsReminder({ date: '2026-10-11', time: '09:59' }) === null && R.requestsReminder({ date: '2026-10-12', time: '18:00' }) === null && R.requestsReminder({ date: '2026-10-13', time: '10:00' }) === null && R.requestsReminder({ date: '2026-10-17', time: '10:00' }) === null)
check('the weekday maths agrees with the app (2026-10-11 is a Sunday)', R.weekdayOf('2026-10-11') === 0 && R.sundayOnOrBefore('2026-10-14') === '2026-10-11')

section('where tapping an alert goes')
check('a path the app wrote is kept', R.pushPathFor('checklist.late', { url: '/staff/checklists' }) === '/staff/checklists')
check('an absolute URL in a stored link is ignored (no open redirect)', R.pushPathFor('swap.open', { url: 'https://evil.example/x' }) === '/staff/schedule')
check('a protocol-relative URL is ignored', R.pushPathFor('swap.open', { url: '//evil.example' }) === '/staff/schedule')
check('a javascript: URL is ignored', R.pushPathFor('x', { url: 'javascript:alert(1)' }) === '/staff/schedule')
check('checklist kinds default to the checklists page', R.pushPathFor('checklist.gap', {}) === '/staff/checklists')
check('everything from the scheduler defaults to the schedule', ['swap.request', 'schedule.published', 'request.approved'].every((k) => R.pushPathFor(k, { tab: 'requests' }) === '/staff/schedule'))
check('no link at all is fine', R.pushPathFor('swap.open', null) === '/staff/schedule')

section('wiring')
const api = read('src/app/api/staff/push/route.ts')
check('subscribing takes the person from the session, never the body', /resolveStaffIdentity\(\)/.test(api) && /staff_id: me\.id/.test(api) && !/staff_id:\s*input/.test(api))
check('unsubscribe and status are scoped to the signed-in person', (api.match(/\.eq\('staff_id', me\.id\)/g) ?? []).length >= 2)
check('only https push endpoints are accepted', /startsWith\('https:\/\/'\)/.test(api))
const cron = read('src/app/api/cron/staff-push/route.ts')
check('the cron route accepts only CRON_SECRET or the database-held secret, otherwise 401', /process\.env\.CRON_SECRET/.test(cron) && /staff_push_verify_cron/.test(cron) && /if \(!allowed\) throw Unauthorized/.test(cron) && /bearer\.length >= 32/.test(cron))
check('an unset CRON_SECRET can never match an empty bearer', /!!envSecret && bearer === envSecret/.test(cron))
check('vercel.json has no sub-daily cron (it would fail the deploy on the Hobby plan)', JSON.parse(read('vercel.json')).crons.every((c) => /^\d+ \d+ \* \* \*$/.test(c.schedule)))
const sw = read('public/sw.js')
check('the service worker tags staff alerts so they replace instead of stacking', /isStaff \? data\.tag/.test(sw))
check('the service worker still handles customer order alerts', /order-\$\{data\.orderId\}/.test(sw))
const client = read('src/lib/push/client.ts')
const orderOff = client.slice(client.indexOf('export async function unsubscribeFromOrderPush'), client.indexOf('// Staff app'))
check('turning off an ORDER alert never kills the browser subscription staff alerts share', orderOff.length > 100 && !/subscription\.unsubscribe\(\)/.test(orderOff))
const ownerDash = read('src/app/owner/dashboard/page.tsx')
check(
  'the card is on the staff home, both owner dashboard views and the onboarding wizard',
  /<StaffPushCard/.test(read('src/app/staff/page.tsx')) && (ownerDash.match(/<StaffPushCard/g) ?? []).length === 2 && /<StaffPushCard variant="wizard"/.test(read('src/components/staff/StaffOnboarding.tsx'))
)
const dispatch = read('src/app/api/shifts/dispatch/route.ts')
check('request-driven writes push what they just notified', /after\(async \(\) => \{[\s\S]*await flushStaffPush\(\)/.test(dispatch))
check('publishing announces the requests for the week after, BEFORE the flush', /publishWeek'\) await announceRequestsOpen\(action\.weekId\)/.test(dispatch) && dispatch.indexOf('announceRequestsOpen(action.weekId)') < dispatch.indexOf('await flushStaffPush()'))
const rem = read('src/lib/push/staff-reminders.ts')
check('checklists are found through the SHIFTS in range, never by when the checklist row was created (it dropped every checklist after day 3)', /\.in\('shift_id'/.test(rem) && !/created_at/.test(rem))
check('an owner who is also the assignee is told about their own missing checklist (self-test)', !/owner\.id === d\.staffId/.test(rem) && /badge\.eq\.developer/.test(rem))
check('every reminder is written once: each one carries a dedupe key', (rem.match(/dedupe_key: `/g) ?? []).length >= 6)
check('the weekly request reminders cover permanent branches only, schedulable Google-linked staff, and skip people who already submitted', /branch\.kind !== 'permanent'/.test(rem) && /auth_user_id/.test(rem) && /status', 'submitted'/.test(rem))
const push = read('src/lib/push/staff.ts')
check('rows are claimed BEFORE sending (at-most-once, no double sends from overlapping runs)', push.indexOf('.update({ push_sent_at: now })') > -1 && push.indexOf('.update({ push_sent_at: now })') < push.indexOf('sendToOne(service, device, payload)'))
check('a gone subscription (404/410) is deleted', /404 \|\| statusCode === 410/.test(push))
const mig = read('supabase/migrations/20261012120000_staff_push_notifications.sql')
const devApi = api
check('the developer actions are refused server-side for everyone else', /isPushDeveloper\(me\)\) throw Forbidden/.test(devApi) && /action: z\.literal\('dev_send'\)/.test(devApi))
check('the developer panel is rendered only for developers', /isPushDeveloper\(me\) && <DevPushPanel \/>/.test(ownerDash) && (ownerDash.match(/<DevPushPanel/g) ?? []).length === 1)
check('developer test rows are stamped read and go through the real inbox + flush', /read_at: now/.test(read('src/lib/push/dev.ts')) && /flushStaffPush\(\)/.test(read('src/lib/push/dev.ts')) && /from\('schedule_notifications'\)/.test(read('src/lib/push/dev.ts')))
const sched = read('supabase/migrations/20261012130000_staff_push_scheduler.sql')
check('scheduler migration: runs every 2 minutes under a fixed job name, secret from Vault, guarded for databases without the extensions', /cron\.schedule\('staff-push', '\*\/2 \* \* \* \*'/.test(sched) && /vault\.create_secret/.test(sched) && /pg_available_extensions/.test(sched) && !/Bearer [0-9a-f]{20,}/.test(sched))
check('migration: RLS on, no browser grants', /enable row level security/.test(mig) && /revoke all on public\.staff_push_subscriptions from public, anon, authenticated/.test(mig))

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
