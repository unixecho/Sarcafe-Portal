// Checks for the shift-time checklist rules and the wiring around them: the real window.ts (transpiled), the API
// gate, the owner's tracker, the staff home cards, the developer corner and the home-screen launch guard.
//
//   node scripts/check-checklist-window.mjs

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
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`)
const section = (t) => console.log(`\n${t}`)

const dir = mkdtempSync(join(tmpdir(), 'check-checklist-window-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp dir */ } })
const load = async (file, name) => {
  const out = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  writeFileSync(join(dir, name), out)
  return import(pathToFileURL(join(dir, name)).href)
}
const W = await load('src/lib/checklists/window.ts', 'window.mjs')
const G = await load('src/lib/staff/launch.ts', 'launch.mjs')

const morning = { date: '2026-10-13', startTime: '07:30', endTime: '13:00' }
const at = (date, time) => ({ date, time })

section('not before the shift')
check('locked an hour before', W.isChecklistLocked(morning, at('2026-10-13', '06:30')))
check('locked one minute before', W.isChecklistLocked(morning, at('2026-10-13', '07:29')))
check('open at the minute the shift starts', !W.isChecklistLocked(morning, at('2026-10-13', '07:30')))
check('locked the day before', W.isChecklistLocked(morning, at('2026-10-12', '23:59')))
check('open during and after the shift', !W.isChecklistLocked(morning, at('2026-10-13', '10:00')) && !W.isChecklistLocked(morning, at('2026-10-14', '09:00')))
eq('unlock moment is the shift start', W.unlockMoment(morning), at('2026-10-13', '07:30'))
eq('minutes until unlock', W.minutesUntilUnlock(morning, at('2026-10-13', '06:30')), 60)
check('the shift gets no head start by default', W.CHECKLIST_EARLY_MINUTES === 0)
eq('unlock text today', W.unlockText(morning, at('2026-10-13', '06:00')), 'ייפתח היום ב־07:30')
eq('unlock text tomorrow', W.unlockText(morning, at('2026-10-12', '20:00')), 'ייפתח מחר ב־07:30')
check('unlock text further out names the day', /ייפתח יום שלישי 13\.10 ב־07:30/.test(W.unlockText(morning, at('2026-10-09', '12:00'))), W.unlockText(morning, at('2026-10-09', '12:00')))

section('each checklist opens at its own moment')
{
  const evening = { date: '2026-10-14', startTime: '13:00', endTime: '19:00' }
  const locked = (extra, time, date = '2026-10-14') => W.isChecklistLocked({ ...evening, ...extra }, at(date, time))
  check('closing is shut at 13:00 (the bug: it used to open with the shift) and until 18:29', locked({ kind: 'closing' }, '13:00') && locked({ kind: 'closing' }, '15:00') && locked({ kind: 'closing' }, '18:29'))
  check('closing opens at 18:30, half an hour before the shift ends, and stays open afterwards', !locked({ kind: 'closing' }, '18:30') && !locked({ kind: 'closing' }, '19:45') && !locked({ kind: 'closing' }, '03:00', '2026-10-15'))
  check('the arriving handover (the shift has no opening) still opens at the start', locked({ kind: 'handover', shiftHasOpening: false }, '12:59') && !locked({ kind: 'handover', shiftHasOpening: false }, '13:00'))
  check('the departing handover (the same person also opened) opens half an hour before the end, like closing', locked({ kind: 'handover', shiftHasOpening: true }, '18:29') && !locked({ kind: 'handover', shiftHasOpening: true }, '18:30'))
  check('opening still opens at the start', locked({ kind: 'opening' }, '12:59') && !locked({ kind: 'opening' }, '13:00'))
  check('a caller that only knows the shift (no kind) keeps the old rule: open at the start', !locked({}, '13:00') && locked({}, '12:59'))
  eq('the unlock moment of closing', W.unlockMoment({ ...evening, kind: 'closing' }), at('2026-10-14', '18:30'))
  eq('what the screen says', W.unlockText({ ...evening, kind: 'closing' }, at('2026-10-14', '10:03')), 'ייפתח היום ב־18:30')
  eq('…and the day before', W.unlockText({ ...evening, kind: 'closing' }, at('2026-10-13', '20:00')), 'ייפתח מחר ב־18:30')
  eq('minutes until closing opens', W.minutesUntilUnlock({ ...evening, kind: 'closing' }, at('2026-10-14', '18:00')), 30)
  check('a shift shorter than half an hour opens its closing at the start, never before it', W.unlockAbs({ date: '2026-10-14', startTime: '18:00', endTime: '18:20', kind: 'closing' }) === W.shiftStartAbs({ date: '2026-10-14', startTime: '18:00', endTime: '18:20' }))
  eq('an overnight shift (22:00-02:00) opens its closing at 01:30 the next day', W.unlockMoment({ date: '2026-10-14', startTime: '22:00', endTime: '02:00', kind: 'closing' }), at('2026-10-15', '01:30'))
  check('the reason differs by kind', W.lockedBecause({ ...evening, kind: 'closing' }).includes('חצי שעה לפני סוף המשמרת') && W.lockedBecause({ ...evening, kind: 'opening' }).includes('המשמרת עוד לא התחילה'))
  eq('the tracker greys closing until it opens, then it is open', [W.checklistPhase({ ...evening, kind: 'closing', status: 'pending' }, at('2026-10-14', '13:30')), W.checklistPhase({ ...evening, kind: 'closing', status: 'pending' }, at('2026-10-14', '18:30'))], ['upcoming', 'open'])
  eq('…and late only 90 minutes after the end', [W.checklistPhase({ ...evening, kind: 'closing', status: 'pending' }, at('2026-10-14', '20:29')), W.checklistPhase({ ...evening, kind: 'closing', status: 'pending' }, at('2026-10-14', '20:30'))], ['open', 'late'])
  const rules = await load('src/lib/push/staff-rules.ts', 'rules-anchor.mjs')
  const differ = ['opening', 'handover', 'closing'].flatMap((kind) => [true, false].filter((has) => W.checklistAnchor(kind, has) !== rules.dueAnchor(kind, has)).map((has) => `${kind}/${has}`))
  check('the lock and the alerts hang every checklist on the same end of the shift', differ.length === 0, differ.join(', '))
  const apiSrc = read('src/app/api/checklists/route.ts')
  check('the API decides by kind and by whether the shift has an opening', /checklist_kind/.test(apiSrc) && /eq\('checklist_kind', 'opening'\)/.test(apiSrc) && /lockedBecause\(lock\)/.test(apiSrc))
  const cardSrc = read('src/components/staff/ShiftStatusCard.tsx')
  check('the home card and the list lock each checklist by its own moment', cardSrc.includes('const lockFor = (shift: ShiftBrief, item: ShiftChecklistBrief)') && cardSrc.includes('isChecklistLocked(lockFor(shift, item), now)') && read('src/components/checklists/StaffChecklistWorkspace.tsx').includes('const lockOf = (assignment: ChecklistAssignment)'))
}

section('overnight shifts')
const night = { date: '2026-10-13', startTime: '22:00', endTime: '02:00' }
check('night shift locked in the evening before it', W.isChecklistLocked(night, at('2026-10-13', '21:00')))
check('night shift open after midnight', !W.isChecklistLocked(night, at('2026-10-14', '00:30')))
eq('night shift ends the next day', W.shiftEndAbs(night) - W.shiftStartAbs(night), 240)

section('phase of a checklist (the tracker)')
const base = { ...morning, kind: 'opening', status: 'pending', shiftHasOpening: true }
eq('future and untouched', W.checklistPhase(base, at('2026-10-12', '12:00')), 'upcoming')
eq('on the shift, not yet due', W.checklistPhase(base, at('2026-10-13', '08:00')), 'open')
eq('opening is late 60 min after the shift starts', W.checklistPhase(base, at('2026-10-13', '08:30')), 'late')
eq('opening is still on time a minute before', W.checklistPhase(base, at('2026-10-13', '08:29')), 'open')
eq('closing is open until 90 min after the end', W.checklistPhase({ ...base, kind: 'closing' }, at('2026-10-13', '14:29')), 'open')
eq('closing is late from that minute (the alert goes out at the same minute)', W.checklistPhase({ ...base, kind: 'closing' }, at('2026-10-13', '14:30')), 'late')
eq('closing is still open 10 min after the end (the old grace)', W.checklistPhase({ ...base, kind: 'closing' }, at('2026-10-13', '13:10')), 'open')
eq('the leaving handover hangs on the end: shut until half an hour before it, then open', [W.checklistPhase({ ...base, kind: 'handover', shiftHasOpening: true }, at('2026-10-13', '12:00')), W.checklistPhase({ ...base, kind: 'handover', shiftHasOpening: true }, at('2026-10-13', '12:30'))], ['upcoming', 'open'])
eq('the arriving handover hangs on the start', W.checklistPhase({ ...base, kind: 'handover', shiftHasOpening: false }, at('2026-10-13', '08:31')), 'late')
eq('submitted wins over everything, even a future shift', W.checklistPhase({ ...base, status: 'submitted' }, at('2026-10-12', '12:00')), 'submitted')
eq('started on a future shift is still locked', W.checklistPhase({ ...base, status: 'in_progress' }, at('2026-10-12', '12:00')), 'upcoming')

section('keeping time without the phone')
eq('advance by whole minutes', W.advanceClock(at('2026-10-13', '07:29'), 61_000), at('2026-10-13', '07:30'))
eq('advance never goes back', W.advanceClock(at('2026-10-13', '07:29'), -5000), at('2026-10-13', '07:29'))
eq('advance crosses midnight', W.advanceClock(at('2026-10-13', '23:59'), 120_000), at('2026-10-14', '00:01'))
eq('day label', W.dayLabel('2026-10-13'), 'יום שלישי · 13.10')

section('the API refuses early work')
const api = read('src/app/api/checklists/route.ts')
check('save and submit share the gate', api.indexOf('isChecklistLocked(lock, wallNow)') > api.indexOf("if (row.status === 'submitted')") && api.indexOf('isChecklistLocked(lock, wallNow)') < api.indexOf("if (body.action === 'save')"))
check('the gate answers 409 too_early', /ApiError\(409, 'too_early'/.test(api))
check('the clock is the branch clock, not the phone', /wallClockNow\(\(shiftBranch\?\.timezone/.test(api))
check('the list carries the server clock', /serverNow, assignments/.test(api))
check('developer previews never reach the API', read('src/components/checklists/StaffChecklistWorkspace.tsx').includes('if (active.testMode) {'))

section('employee list greys out the future')
const runner = read('src/components/checklists/StaffChecklistWorkspace.tsx')
check('locked cards are disabled', /disabled=\{closed \|\| locked\}/.test(runner) && /const closed = assignment\.status === 'submitted' \|\| dismissed/.test(runner))
check('locked cards say when they open', runner.includes('unlockText('))
check('locked cards are greyed in CSS', /\.ck-card--locked[^{]*\{[^}]*grayscale/.test(read('src/components/checklists/checklists.css')))
check('open() refuses a locked checklist', /if \(lockedAt\(assignment\)\) return setError/.test(runner))
check('a deep link opens a checklist once', runner.includes('deepLink.current = { open: null, preview: null }'))

section('owner tracker (מעקב משמרות)')
const owner = read('src/components/checklists/OwnerChecklistWorkspace.tsx')
const ownerApi = read('src/app/api/owner/checklists/route.ts')
check('rows are grouped by day with a centred spacer', owner.includes('className={`ck-spacer') && /\.ck-spacer::before[\s\S]*\.ck-spacer::after/.test(read('src/components/checklists/checklists.css')))
check('the list is explicitly RTL', owner.includes('className="ck-wrap ck-track" dir="rtl"'))
check('employee colour comes from the scheduler roster', ownerApi.includes("staffColor(row.staff_id as string, roster)") && ownerApi.includes('isOp(row)'))
check('branch colour is its own distinct pill', owner.includes('branchColor(data.branch.slug, branches)') && read('src/lib/branches/color.ts').includes('BRANCH_PALETTE'))
check('a status chip per row', owner.includes('ck-status ck-status--${row.phase}'))
check('future rows are inert and greyed', owner.includes('inert={future || undefined}') && /\.ck-track-row--upcoming[^{]*\{[^}]*grayscale/.test(read('src/components/checklists/checklists.css')))
check('rows come back in date order', ownerApi.includes('assignments.sort('))
const branches = [{ slug: 'maor' }, { slug: 'givat-haviva' }, { slug: 'event' }]
const colors = await load('src/lib/branches/color.ts', 'color.mjs')
check('two branches never share a colour', colors.branchColor('maor', branches) !== colors.branchColor('givat-haviva', branches) && new Set(branches.map((b) => colors.branchColor(b.slug, branches))).size === 3)
check('a branch colour does not move when the list is reordered', colors.branchColor('maor', branches) === colors.branchColor('maor', [...branches].reverse()))

section('staff home')
const home = read('src/app/staff/page.tsx')
const card = read('src/components/staff/ShiftStatusCard.tsx')
check('the shift-status card is mounted', home.includes('<ShiftStatusCard status={shiftStatus}'))
check('on-shift card offers the submit button, straight to that checklist', card.includes('הגשת צ׳קליסט') && card.includes('staffChecklistPath(item.id)') && !card.includes('?open='))
check('before the shift the button is locked and says when', card.includes('app-shiftcard__cta--locked') && card.includes('unlockText(lockFor(shift, item), now)'))
check('the card trusts the server clock', card.includes('advanceClock(status.serverNow'))
check('the Gmail card shows only while no Google account is linked', home.includes('{!me.auth_user_id && <GoogleLinkPrompt />}'))
const prompt = read('src/components/staff/GoogleLinkPrompt.tsx')
check('the Gmail card has a notification dot and an animated walkthrough', prompt.includes('glp-card__dot') && prompt.includes('glp__draw') && prompt.includes('GoogleLinkButton'))
check('the walkthrough respects reduced motion', /prefers-reduced-motion[\s\S]*glp__draw/.test(read('src/components/staff/google-prompt.css')))
const quick = read('src/app/api/auth/quick-login/route.ts')
check('no forced redirect to the profile after a code login', !quick.includes('/staff/profile?setup=google'))

section('developer corner')
check('developers are not bounced to the owner dashboard', home.includes('if (fullLogin && isOp(me) && !developer) redirect'))
check('the dev page is developer-only and server-checked', read('src/app/staff/dev/page.tsx').includes('if (!isDeveloper(me)) redirect'))
check('test tools moved off the owner dashboard', !read('src/app/owner/dashboard/page.tsx').includes('<DevPushPanel') && read('src/app/staff/dev/page.tsx').includes('<DevPushPanel'))
check('the callback sends a developer to the employee panel', /isOp\(staffRow\) && !isDeveloper/.test(read('src/app/auth/callback/route.ts')))
check('test shift is a developer-only card state', card.includes('developer && sim') && card.includes('?preview=${item.kind}'))

section('home-screen launch')
{
  eq('bare register → home', G.launchRedirect({ pathname: '/pos', search: '' }), '/staff')
  eq('register with a stray branch hint is a station link, kept', G.launchRedirect({ pathname: '/pos', search: '?branch=maor' }), null)
  eq('station link kept', G.launchRedirect({ pathname: '/pos', search: '?v=station&p=abc' }), null)
  eq('code sign-in heading to the register → staff sign-in', G.launchRedirect({ pathname: '/login', search: '?next=/pos&quick=1' }), '/login?next=/staff&quick=1')
  eq('checklist QR sign-in → staff sign-in', G.launchRedirect({ pathname: '/login', search: '?next=/staff/checklists&quick=1' }), '/login?next=/staff&quick=1')
  eq('staff sign-in left alone', G.launchRedirect({ pathname: '/login', search: '?next=/staff&quick=1' }), null)
  eq('plain sign-in left alone', G.launchRedirect({ pathname: '/login', search: '' }), null)
  eq('a deep link from a notification left alone', G.launchRedirect({ pathname: '/staff/schedule', search: '' }), null)
}
const guard = read('src/components/StandaloneLaunchGuard.tsx')
check('the guard only acts as an installed app, on the first page of a launch', guard.includes("display-mode: standalone") && guard.includes('if (!first) return'))
check('the guard is mounted for every page', read('src/app/layout.tsx').includes('<StandaloneLaunchGuard />'))
const install = read('src/components/staff/StaffInstallIntro.tsx')
check('iPhone install is steered to the home page first', install.includes("ios && !installed && pathname !== '/staff'") && install.includes("router.push('/staff')"))
check('the staff manifest still starts at /staff', JSON.parse(read('public/staff-manifest.json')).start_url === '/staff')

section('dismissing a checklist nobody sent')
{
  check('a pending or started row with an owner mark reads as dismissed; a sent one never does', W.isDismissed({ status: 'pending', resolvedAt: '2026-10-13T20:00:00Z' }) && W.isDismissed({ status: 'in_progress', resolvedAt: 'x' }) && !W.isDismissed({ status: 'submitted', resolvedAt: 'x' }) && !W.isDismissed({ status: 'pending', resolvedAt: null }) && !W.isDismissed({ status: 'pending' }))
  eq('dismissed wins over late', W.checklistPhase({ ...base, kind: 'closing', dismissed: true }, at('2026-10-13', '23:00')), 'dismissed')
  eq('dismissed wins over a future shift too (a closed day)', W.checklistPhase({ ...base, dismissed: true }, at('2026-10-12', '12:00')), 'dismissed')
  eq('a sent checklist stays sent even if an owner mark is present', W.checklistPhase({ ...base, status: 'submitted', dismissed: true }, at('2026-10-13', '23:00')), 'submitted')
  eq('without the flag the same row is late (the flag is the only difference)', W.checklistPhase({ ...base, kind: 'closing' }, at('2026-10-13', '23:00')), 'late')
  const ownerApiSrc = read('src/app/api/owner/checklists/route.ts')
  const employeeApiSrc = read('src/app/api/checklists/route.ts')
  const trackerSrc = read('src/components/checklists/OwnerChecklistWorkspace.tsx')
  check('the owner API has dismiss and restore, refuses a sent checklist and reuses the existing owner columns (no migration)', /z\.literal\('dismiss'\)/.test(ownerApiSrc) && /z\.literal\('restore'\)/.test(ownerApiSrc) && /row\.status === 'submitted'\) throw new ApiError\(409/.test(ownerApiSrc) && /manager_resolved_at: new Date/.test(ownerApiSrc) && !/status: 'dismissed'/.test(ownerApiSrc))
  check('the employee API closes a dismissed checklist for save and submit alike', employeeApiSrc.indexOf("isDismissed({ status: row.status") > employeeApiSrc.indexOf("row.status === 'submitted'") && employeeApiSrc.indexOf("isDismissed({ status: row.status") < employeeApiSrc.indexOf("if (body.action === 'save')"))
  check('only a checklist that is due (open or late) shows the dismiss button; a dismissed one shows restore', trackerSrc.includes("const canDismiss = row.phase === 'open' || row.phase === 'late'") && trackerSrc.includes("act('dismiss', row.id") && trackerSrc.includes("act('restore', row.id)"))
  check('dismissing asks first (an optional reason, then a confirm), restoring is one tap', trackerSrc.includes('setDismissing(row.id)') && trackerSrc.includes('אישור ביטול'))
  check('the tracker\'s late banner counts the phase, so a dismissed row is not in it', trackerSrc.includes("rows.filter((row) => row.phase === 'late').length"))
  check('the owner list tells the tracker which rows are dismissed', ownerApiSrc.includes('dismissed: isDismissed('))
  check('the employee list tells the screen which rows are dismissed, and the home card ignores them', read('src/lib/checklists/server.ts').includes('dismissed: isDismissed(') && card.includes("const waiting = (item: ShiftChecklistBrief) => item.status !== 'submitted' && !item.dismissed"))
  check('dismissed cards are quiet in CSS (employee list and owner tracker)', /\.ck-card--dismissed/.test(read('src/components/checklists/checklists.css')) && /\.ck-track-row--dismissed/.test(read('src/components/checklists/checklists.css')) && /\.ck-status--dismissed/.test(read('src/components/checklists/checklists.css')))
}

section('the home card while closing, and the deep links')
{
  const status = read('src/lib/staff/shift-status.ts')
  const rules = await load('src/lib/push/staff-rules.ts', 'rules.mjs')
  check('a shift that just ended stays on the home card while a checklist waits, for the same grace the alerts use (server and client)', status.includes('END_GRACE_MINUTES') && card.includes('END_GRACE_MINUTES') && /const current = running \?\? winding/.test(card) && rules.END_GRACE_MINUTES === 90)
  check('…and says the shift is over instead of counting down', card.includes('המשמרת הסתיימה'))
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const L = await load('src/lib/checklists/links.ts', 'links.mjs')
  eq('the launch guard still corrects a sign-in saved as the icon address', G.launchRedirect({ pathname: '/login', search: '?next=/pos&quick=1' }), '/login?next=/staff&quick=1')
  eq('…but leaves a sign-in that returns to ONE checklist alone', G.launchRedirect({ pathname: '/login', search: `?next=/staff/checklists/${id}&quick=1` }), null)
  eq('…and still corrects anything that only looks like one', G.launchRedirect({ pathname: '/login', search: `?next=/staff/checklists/${id}/x&quick=1` }), '/login?next=/staff&quick=1')
  check('the launch guard and the link rules accept exactly the same checklist paths', [`/staff/checklists/${id}`, '/staff/checklists', `/staff/checklists/${id}x`, '/staff/checklists/abc', `/staff/checklists/${id.toUpperCase()}`].every((path) => (G.launchRedirect({ pathname: '/login', search: `?next=${path}` }) === null) === L.isStaffChecklistPath(path)))
  const staffPage = read('src/components/checklists/StaffChecklistsPageBody.tsx')
  check('the checklist page takes the branch from the checklist itself', staffPage.includes('branchSlug = own.slug') && staffPage.includes('openId={open}'))
  check('the workspace opens the checklist it was given, or says why it did not', runner.includes('openId ?? params.get') && runner.includes('הצ׳קליסט הזה בוטל על ידי המנהל/ת') && runner.includes('הצ׳קליסט הזה כבר נשלח'))
  const ownerPage = read('src/components/checklists/OwnerChecklistsPageBody.tsx')
  check('the owner page switches to the checklist\'s branch, opens the tracker on it and scrolls to it', ownerPage.includes('branchSlug = branch.slug') && ownerPage.includes('focusId={focus}') && owner.includes("useState<Tab>(focusId ? 'coverage' : 'inbox')") && owner.includes('scrollIntoView'))
  check('the tracker rows can be found by id', owner.includes('id={`ck-row-${row.id}`}'))
}

console.log(`\n${failures.length ? '✗' : '✓'} ${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1) }
