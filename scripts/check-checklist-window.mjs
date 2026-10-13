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

section('overnight shifts')
const night = { date: '2026-10-13', startTime: '22:00', endTime: '02:00' }
check('night shift locked in the evening before it', W.isChecklistLocked(night, at('2026-10-13', '21:00')))
check('night shift open after midnight', !W.isChecklistLocked(night, at('2026-10-14', '00:30')))
eq('night shift ends the next day', W.shiftEndAbs(night) - W.shiftStartAbs(night), 240)

section('phase of a checklist (the tracker)')
const base = { ...morning, kind: 'opening', status: 'pending', shiftHasOpening: true }
eq('future and untouched', W.checklistPhase(base, at('2026-10-12', '12:00')), 'upcoming')
eq('on the shift, not yet due', W.checklistPhase(base, at('2026-10-13', '08:00')), 'open')
eq('opening is late 60 min after the shift starts', W.checklistPhase(base, at('2026-10-13', '08:31')), 'late')
eq('opening is still on time at the 60 min mark', W.checklistPhase(base, at('2026-10-13', '08:30')), 'open')
eq('closing is open until 10 min after the end', W.checklistPhase({ ...base, kind: 'closing' }, at('2026-10-13', '13:10')), 'open')
eq('closing is late after that', W.checklistPhase({ ...base, kind: 'closing' }, at('2026-10-13', '13:11')), 'late')
eq('the leaving handover hangs on the end', W.checklistPhase({ ...base, kind: 'handover', shiftHasOpening: true }, at('2026-10-13', '12:00')), 'open')
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
check('save and submit share the gate', api.indexOf('isChecklistLocked(shiftTimes, wallNow)') > api.indexOf("if (row.status === 'submitted')") && api.indexOf('isChecklistLocked(shiftTimes, wallNow)') < api.indexOf("if (body.action === 'save')"))
check('the gate answers 409 too_early', /ApiError\(409, 'too_early'/.test(api))
check('the clock is the branch clock, not the phone', /wallClockNow\(\(shiftBranch\?\.timezone/.test(api))
check('the list carries the server clock', /serverNow, assignments/.test(api))
check('developer previews never reach the API', read('src/components/checklists/StaffChecklistWorkspace.tsx').includes('if (active.testMode) {'))

section('employee list greys out the future')
const runner = read('src/components/checklists/StaffChecklistWorkspace.tsx')
check('locked cards are disabled', /disabled=\{assignment\.status === 'submitted' \|\| locked\}/.test(runner))
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
check('on-shift card offers the submit button', card.includes('הגשת צ׳קליסט') && card.includes('openHref(shift, item.id)'))
check('before the shift the button is locked and says when', card.includes('app-shiftcard__cta--locked') && card.includes('unlockText(times, now)'))
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

console.log(`\n${failures.length ? '✗' : '✓'} ${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1) }
