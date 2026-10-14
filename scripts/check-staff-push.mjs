// Checks for staff push notifications: the pure timing/routing rules (the real TypeScript, transpiled)
// and the wiring that must not drift (who may subscribe, what the service worker does, where the
// card is mounted, that no sub-daily cron breaks the Hobby deploy).
//
//   node scripts/check-staff-push.mjs

import ts from 'typescript'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
// The two other places that restate a rule these alerts depend on, loaded as real code too.
const load = async (file, name) => {
  writeFileSync(join(dir, name), ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText)
  return import(pathToFileURL(join(dir, name)).href)
}
const W = await load('src/lib/checklists/window.ts', 'window.mjs') // the owner tracker's "late"
const T = await load('src/lib/shifts/time.ts', 'time.mjs') // when requests for the week really close

section('when a checklist falls due')
const closing = { kind: 'closing', date: '2026-10-12', startTime: '13:00', endTime: '19:00' }
check('the end-of-shift grace is an hour and a half (the owner: employees have to actually close)', R.END_GRACE_MINUTES === 90)
check('closing is not due before the shift ends', R.minutesPastDue(closing, { date: '2026-10-12', time: '18:59' }) < 0)
check('…nor 10 minutes after it (the old grace: a 19:00 shift was chased at 19:10)', R.minutesPastDue(closing, { date: '2026-10-12', time: '19:10' }) < 0)
check('…nor a minute before the 90 minutes are up', R.minutesPastDue(closing, { date: '2026-10-12', time: '20:29' }) < 0)
check('closing is due 90 minutes after the shift ends (a 13:00-19:00 shift: 20:30)', R.minutesPastDue(closing, { date: '2026-10-12', time: '20:30' }) === 0)
check('…and counts up from there', R.minutesPastDue(closing, { date: '2026-10-12', time: '21:10' }) === 40)
const night = { kind: 'closing', date: '2026-10-12', startTime: '18:00', endTime: '02:00' }
check('a shift that runs past midnight is due the NEXT day (02:00 + 90 min = 03:30), not at 03:30 today', R.minutesPastDue(night, { date: '2026-10-12', time: '23:00' }) < 0 && R.minutesPastDue(night, { date: '2026-10-13', time: '03:29' }) < 0 && R.minutesPastDue(night, { date: '2026-10-13', time: '03:30' }) === 0)
const opening = { kind: 'opening', date: '2026-10-12', startTime: '07:30', endTime: '13:00' }
check('opening is due an hour after the shift STARTS', R.minutesPastDue(opening, { date: '2026-10-12', time: '08:29' }) < 0 && R.minutesPastDue(opening, { date: '2026-10-12', time: '08:30' }) === 0)
const departing = { kind: 'handover', date: '2026-10-12', startTime: '07:30', endTime: '13:00', shiftHasOpening: true }
check('the handover of the employee who also opens is due 90 minutes after their shift ENDS', R.minutesPastDue(departing, { date: '2026-10-12', time: '14:29' }) < 0 && R.minutesPastDue(departing, { date: '2026-10-12', time: '14:30' }) === 0)
check('opening and the arriving handover keep their hour from the START (the owner only asked to extend the end of the shift)', R.OPENING_GRACE_MINUTES === 60)
const arriving = { kind: 'handover', date: '2026-10-12', startTime: '13:00', endTime: '19:00', shiftHasOpening: false }
check('the handover of the evening employee (no opening on their shift) is due an hour after their shift STARTS', R.minutesPastDue(arriving, { date: '2026-10-12', time: '13:59' }) < 0 && R.minutesPastDue(arriving, { date: '2026-10-12', time: '14:00' }) === 0)
check('a handover with no hint about the shift is treated as the arriving side (1 h after the start)',R.minutesPastDue({ ...closing, kind: 'handover' }, { date: '2026-10-12', time: '14:00' }) === 0)
check('closing stays an end-of-shift checklist whatever else is on the shift', R.minutesPastDue({ ...closing, shiftHasOpening: false }, { date: '2026-10-12', time: '20:30' }) === 0)
check('a shift from yesterday is a full day overdue (the caller cuts it off at the reminder window)', R.minutesPastDue(closing, { date: '2026-10-13', time: '20:30' }) === 24 * 60)
check('owners and developers are told 30 minutes after the employee (after the grace has run out), still inside the reminder window', R.OWNER_ESCALATION_MINUTES === 30 && R.OWNER_ESCALATION_MINUTES < R.REMINDER_WINDOW_MINUTES)
check('an owner alert for the 13:00-19:00 closing lands at 21:00, 2 h after the shift ends, and is not dropped by the window', R.minutesPastDue({ ...closing, shiftHasOpening: false }, { date: '2026-10-12', time: '21:00' }) === R.OWNER_ESCALATION_MINUTES)
check('the evening-shift report (a 13:00-19:00 shift, now 21:20) is still inside the reminder window', R.minutesPastDue({ ...closing, shiftHasOpening: false }, { date: '2026-10-12', time: '21:20' }) <= R.REMINDER_WINDOW_MINUTES)

section('one rule, everywhere: the alert, the owner tracker and the request deadline agree')
{
  // For every minute from the shift's start to hours after its end, "the tracker says late" and "the alert is due"
  // must be the same fact, for every kind of checklist, on a day shift and on one that crosses midnight.
  const shifts = [
    { date: '2026-10-12', startTime: '13:00', endTime: '19:00' },
    { date: '2026-10-12', startTime: '16:30', endTime: '18:30' },
    { date: '2026-10-12', startTime: '22:00', endTime: '02:00' },
  ]
  const kinds = [
    { kind: 'opening', shiftHasOpening: true },
    { kind: 'handover', shiftHasOpening: true },
    { kind: 'handover', shiftHasOpening: false },
    { kind: 'closing', shiftHasOpening: false },
  ]
  const disagreements = []
  for (const shift of shifts) {
    for (const k of kinds) {
      for (let offset = 0; offset <= 16 * 60; offset++) {
        const now = W.advanceClock({ date: shift.date, time: `${shift.startTime}` }, offset * 60_000)
        const phase = W.checklistPhase({ ...shift, ...k, status: 'pending' }, now)
        const due = R.minutesPastDue({ ...shift, ...k }, now) >= 0
        if ((phase === 'late') !== due) disagreements.push(`${shift.startTime}-${shift.endTime} ${k.kind}${k.shiftHasOpening ? '+opening' : ''} +${offset}min`)
      }
    }
  }
  check('tracker "late" and alert "due" flip at the very same minute for every checklist kind', disagreements.length === 0, disagreements.slice(0, 3).join('; '))
  check('the tracker reads the end-of-shift grace as 90 minutes too', W.checklistPhase({ ...shifts[0], kind: 'closing', status: 'pending' }, { date: '2026-10-12', time: '20:29' }) === 'open' && W.checklistPhase({ ...shifts[0], kind: 'closing', status: 'pending' }, { date: '2026-10-12', time: '20:30' }) === 'late')
  const sundays = ['2026-10-11', '2026-10-18', '2026-12-27', '2027-01-03']
  const deadlines = sundays.map((sunday) => [R.requestsReminder({ date: sunday, time: '10:00' })?.closeDate, T.requestDeadline(R.requestsReminder({ date: sunday, time: '10:00' })?.targetWeek)])
  check('the reminders name the same Tuesday the app really closes requests on', deadlines.every(([told, real]) => told && told === real), JSON.stringify(deadlines))
  check('…and that day is a Tuesday', deadlines.every(([told]) => R.weekdayOf(told) === 2))
}

section('delivery is on record, and the heads-up names only what opens at the start')
{
  const pushSrc = read('src/lib/push/staff.ts')
  check('every pushed alert keeps what the push service answered (how many phones, how many accepted, what the refusals said), without any endpoint or key', /async function recordOutcome/.test(pushSrc) && /accepted: results\.filter/.test(pushSrc) && /refused:/.test(pushSrc) && !/endpoint:\s*row\.endpoint[\s\S]{0,40}outcome/.test(pushSrc) && !/p256dh[^\n]*outcome/.test(pushSrc))
  check('an alert claimed with nobody to send to is on record too', /recordOutcome\(service, rows, \[\], 0\)/.test(pushSrc))
  check('a recorded outcome does not change where the alert goes (the resolver ignores everything but url, tab and weekStart)', R.pushPathFor('checklist.late', { url: `/staff/checklists/${'0f8fad5b-d9cb-469f-a165-70867728950e'}`, push: { accepted: 1 } }) === `/staff/checklists/0f8fad5b-d9cb-469f-a165-70867728950e`)
  check('the developer panel lists the last alerts with the push service\'s answer', /recent:/.test(read('src/lib/push/dev.ts')) && /ההתראות האחרונות שלי/.test(read('src/components/staff/DevPushPanel.tsx')))
  check('the heads-up skips closing and a departing handover (they open half an hour before the end)', /dueAnchor\(a\.kind, shiftHasOpening\.has\(a\.shiftId\)\) !== 'start'\) continue/.test(read('src/lib/push/staff-reminders.ts')))
}

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
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
check('an exact checklist link the reminder wrote wins, for the employee and for the owner', R.pushPathFor('checklist.late', { url: `/staff/checklists/${ID}` }) === `/staff/checklists/${ID}` && R.pushPathFor('checklist.gap', { url: `/owner/checklists/${ID}` }) === `/owner/checklists/${ID}`)
check('an absolute URL in a stored link is ignored (no open redirect)', R.pushPathFor('swap.open', { url: 'https://evil.example/x' }) === '/staff/schedule?tab=requests')
check('a protocol-relative URL is ignored', R.pushPathFor('swap.open', { url: '//evil.example' }) === '/staff/schedule?tab=requests')
check('a javascript: URL is ignored', R.pushPathFor('x', { url: 'javascript:alert(1)' }) === '/staff/schedule')
check('an employee checklist alert with no stored link still opens the checklists, an owner one the owner tracker', R.pushPathFor('checklist.late', {}) === '/staff/checklists' && R.pushPathFor('checklist.soon', null) === '/staff/checklists' && R.pushPathFor('checklist.gap', {}) === '/owner/checklists')
check('requests for the week open the availability tab', ['requests.open', 'requests.closing'].every((k) => R.pushPathFor(k, {}) === '/staff/schedule?tab=availability'))
check('swaps, takes and request decisions open the employee\'s requests tab', ['swap.request', 'swap.open', 'swap.accepted', 'swap.declined', 'swap.approved', 'swap.rejected', 'request.approved', 'request.rejected'].every((k) => R.pushPathFor(k, { tab: 'requests' }) === '/staff/schedule?tab=requests'))
check('what waits for a manager opens the manager\'s requests tab, whoever the flag says', ['swap.awaiting', 'request.new', 'request.cancelled', 'availability.submitted'].every((k) => R.pushPathFor(k, { tab: 'requests' }) === '/owner/schedule?tab=requests' && R.pushPathFor(k, { tab: 'requests' }, { manager: true }) === '/owner/schedule?tab=requests'))
check('a cancelled swap goes to the manager\'s tab for a manager and to the employee\'s for an employee', R.pushPathFor('swap.cancelled', { tab: 'requests' }, { manager: true }) === '/owner/schedule?tab=requests' && R.pushPathFor('swap.cancelled', { tab: 'requests' }, { manager: false }) === '/staff/schedule?tab=requests' && R.pushPathFor('swap.cancelled', { tab: 'requests' }) === '/staff/schedule?tab=requests')
check('a published schedule and the shift reminders open the schedule', ['schedule.published', 'schedule.hours_synced', 'shift.eve', 'shift.today'].every((k) => R.pushPathFor(k, {}) === '/staff/schedule'))
check('a week hint is carried to the tab it belongs to', R.pushPathFor('schedule.published', { weekStart: '2026-10-18' }) === '/staff/schedule?week=2026-10-18' && R.pushPathFor('swap.request', { tab: 'requests', weekStart: '2026-10-18' }) === '/staff/schedule?tab=requests&week=2026-10-18' && R.pushPathFor('request.new', { weekStart: '2026-10-18' }) === '/owner/schedule?tab=requests&week=2026-10-18')
check('a malformed week hint is dropped, never put in a URL', R.pushPathFor('schedule.published', { weekStart: '2026-10-18"><script>' }) === '/staff/schedule' && R.pushPathFor('swap.request', { weekStart: 'next week' }) === '/staff/schedule?tab=requests')
check('no link at all is fine', R.pushPathFor('swap.open', null) === '/staff/schedule?tab=requests' && R.pushPathFor('schedule.published', null) === '/staff/schedule')
{
  // Every destination the resolver can produce is a page that exists (a link to nowhere would read as a broken alert).
  const kinds = ['checklist.late', 'checklist.soon', 'checklist.gap', 'requests.open', 'swap.request', 'swap.awaiting', 'schedule.published', 'shift.eve', 'request.new']
  const bases = new Set(kinds.flatMap((k) => [false, true].map((manager) => R.pushPathFor(k, { weekStart: '2026-10-18' }, { manager }).split('?')[0])))
  const missing = [...bases].filter((route) => !existsSync(join(ROOT, 'src/app', ...route.split('/').filter(Boolean), 'page.tsx')))
  check('every destination is a real page', missing.length === 0, missing.join(', '))
}

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
check('the checklist alerts name their exact checklist: the employee\'s and the heads-up open /staff/checklists/<id>, the owner\'s opens /owner/checklists/<id>', (rem.match(/staffChecklistPath\(/g) ?? []).length >= 2 && (rem.match(/ownerChecklistPath\(/g) ?? []).length === 1 && !/url: '\/(staff|owner)\/checklists'/.test(rem))
check('a checklist an owner dismissed is not asked for again: the reminder writer skips it before every alert', /manager_resolved_at/.test(rem) && /&& !a\.manager_resolved_at/.test(rem))
const push = read('src/lib/push/staff.ts')
check('the phone push resolves its destination per recipient (manager or not), and a digest goes where all its alerts go', /pushPathFor\(r\.kind, r\.link, recipient\)/.test(push) && /function digestPath/.test(push) && /hasAnyMenuEditAccess/.test(push))
check('the notification bar uses the same resolver as the push, so a tap on either lands in the same place', /pushPathFor\(item\.kind \?\? '', item\.link \?\? null, \{ manager \}\)/.test(read('src/components/app/DashboardNotifications.tsx')) && /kind, title, body, link/.test(read('src/app/staff/page.tsx')) && /kind, title, body, link/.test(read('src/app/owner/dashboard/page.tsx')) && /kind, title, body, link/.test(read('src/app/api/staff/notifications/route.ts')))
{
  // A checklist link has to survive sign-in: login's `next` only keeps plain path characters (a query would be dropped).
  const L = await load('src/lib/checklists/links.ts', 'links.mjs')
  check('the checklist links are plain paths, so they survive the sign-in redirect', /^\/[A-Za-z0-9/_-]*$/.test(L.staffChecklistPath(ID)) && /^\/[A-Za-z0-9/_-]*$/.test(L.ownerChecklistPath(ID)))
  check('only an exact checklist id is accepted as a sign-in destination', L.isStaffChecklistPath(`/staff/checklists/${ID}`) && !L.isStaffChecklistPath('/staff/checklists') && !L.isStaffChecklistPath(`/staff/checklists/${ID}/x`) && !L.isStaffChecklistPath('/staff/checklists/not-an-id') && !L.isStaffChecklistPath(`/owner/checklists/${ID}`) && L.isOwnerChecklistPath(`/owner/checklists/${ID}`) && !L.isOwnerChecklistPath(`/staff/checklists/${ID}`))
}
const mw = read('src/middleware.ts')
check('the middleware keeps the checklist id through the sign-in redirect (staff and owner), and falls back to the list for anything else', /isStaffChecklistPath\(pathname\) \? pathname : '\/staff\/checklists'/.test(mw) && /isOwnerChecklistPath\(pathname\)\) url\.searchParams\.set\('next', pathname\)/.test(mw))
check('the code sign-in page and route accept a checklist destination', /isStaffChecklistPath\(next\) \? next/.test(read('src/app/login/page.tsx')) && /refine\(isStaffChecklistPath\)/.test(read('src/app/api/auth/quick-login/route.ts')))
for (const route of ['src/app/staff/checklists/[id]/page.tsx', 'src/app/owner/checklists/[id]/page.tsx']) check(`the per-checklist page exists (${route})`, existsSync(join(ROOT, route)))
const staffBody = read('src/components/checklists/StaffChecklistsPageBody.tsx')
check('an id that is not the signed-in person\'s own is ignored, never revealed', /row\.staff_id === me\.id/.test(staffBody) && /isChecklistId\(openId\)/.test(staffBody))
check('rows are claimed BEFORE sending (at-most-once, no double sends from overlapping runs)', push.indexOf('.update({ push_sent_at: now })') > -1 && push.indexOf('.update({ push_sent_at: now })') < push.indexOf('sendToOne(service, device, payload)'))
check('a gone subscription (404/410) is deleted', /404 \|\| statusCode === 410/.test(push))
const mig = read('supabase/migrations/20261012120000_staff_push_notifications.sql')
const devApi = api
check('the developer actions are refused server-side for everyone else', /isPushDeveloper\(me\)\) throw Forbidden/.test(devApi) && /action: z\.literal\('dev_send'\)/.test(devApi))
const devPage = read('src/app/staff/dev/page.tsx')
check('the developer panel is rendered only for developers (the /staff/dev page; the owner dashboard only links to it)', /if \(!isDeveloper\(me\)\) redirect/.test(devPage) && (devPage.match(/<DevPushPanel/g) ?? []).length === 1 && !/<DevPushPanel/.test(ownerDash) && /isDeveloper\(me\)/.test(ownerDash))
check('the page rule and the API rule are the same developer rule', /badge === 'developer' \|\| isChecklistDeveloper\(row\.email\)/.test(read('src/lib/checklists/developer.ts')) && /badge === 'developer' \|\| isChecklistDeveloper\(me\.email\)/.test(read('src/lib/push/dev.ts')))
check('developer test rows are stamped read and go through the real inbox + flush', /read_at: now/.test(read('src/lib/push/dev.ts')) && /flushStaffPush\(\)/.test(read('src/lib/push/dev.ts')) && /from\('schedule_notifications'\)/.test(read('src/lib/push/dev.ts')))
const sched = read('supabase/migrations/20261012130000_staff_push_scheduler.sql')
check('scheduler migration: runs every 2 minutes under a fixed job name, secret from Vault, guarded for databases without the extensions', /cron\.schedule\('staff-push', '\*\/2 \* \* \* \*'/.test(sched) && /vault\.create_secret/.test(sched) && /pg_available_extensions/.test(sched) && !/Bearer [0-9a-f]{20,}/.test(sched))
check('migration: RLS on, no browser grants', /enable row level security/.test(mig) && /revoke all on public\.staff_push_subscriptions from public, anon, authenticated/.test(mig))

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
