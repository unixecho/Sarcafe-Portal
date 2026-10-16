// Checks for the branch manager (/owner/branches), the developer's single dashboard (/staff/dev) and the two dashboard
// bodies they share (2026-10-16). The pure lens list is transpiled and run; the pages, routes, components and the
// migration are read and compared with each other.
//
//   node scripts/check-branch-manager.mjs

import ts from 'typescript'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

const dir = mkdtempSync(join(tmpdir(), 'check-branch-manager-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp dir */ } })
writeFileSync(join(dir, 'lens.mjs'), ts.transpileModule(read('src/lib/dashboard/lens.ts'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText)
const L = await import(pathToFileURL(join(dir, 'lens.mjs')).href)

section('the developer\'s views: manager, employee, developer, and their own notification centre')
eq('manager, employee, developer, in the owner\'s order, then the notification centre', L.LENSES.map((l) => l.id), ['manager', 'employee', 'dev', 'alerts'])
eq('the developer\'s own tools are the default', L.DEFAULT_LENS, 'dev')
eq('?view= is made safe', [L.parseLens('manager'), L.parseLens('employee'), L.parseLens('dev'), L.parseLens('alerts'), L.parseLens('nonsense'), L.parseLens(undefined), L.parseLens(['employee', 'x']), L.parseLens('<script>')], ['manager', 'employee', 'dev', 'alerts', 'dev', 'dev', 'employee', 'dev'])
eq('a developer who is not an owner has no manager view', L.lensesFor(false).map((l) => l.id), ['employee', 'dev', 'alerts'])
eq('an owner-developer has all of them', L.lensesFor(true).map((l) => l.id), ['manager', 'employee', 'dev', 'alerts'])

section('one dashboard, no second place to be')
const dev = read('src/app/staff/dev/page.tsx')
const staffHome = read('src/app/staff/page.tsx')
const ownerHome = read('src/app/owner/dashboard/page.tsx')
check('the dev page is developer-only and checked on the server', /if \(!isDeveloper\(me\)\) redirect\('\/staff'\)/.test(dev))
check('the manager view needs a full (Google) owner login, so it never leads to a wall', /const canManage = fullLogin && isOp\(me\)/.test(dev) && /lensesFor\(canManage\)/.test(dev))
check('all three views are built on the server up front and handed to the switcher (switching is instant); the manager view only for a full owner login', /const panels: Parameters<typeof LensTabs>\[0\]\['panels'\] = \{/.test(dev) && /employee: <EmployeeDashboardView/.test(dev) && /dev: DevPanel\(\{ health \}\)/.test(dev) && /alerts: <DevNotificationCenter/.test(dev) && /\.\.\.\(canManage \? \{ manager: <OwnerDashboardView/.test(dev))
check('the manager and employee views are the SAME components the owner and employees get', /<OwnerDashboardView/.test(dev) && /<EmployeeDashboardView/.test(dev) && /<OwnerDashboardView/.test(ownerHome) && /<EmployeeDashboardView/.test(staffHome))
check('a developer who opens the employee home or the owner dashboard is sent to the matching view', /isDeveloper\(me\)\) redirect\('\/staff\/dev\?view=employee'\)/.test(staffHome) && /isDeveloper\(me\)\) redirect\('\/staff\/dev\?view=manager'\)/.test(ownerHome))
check('other owners still land on the owner dashboard, employees on theirs', /fullLogin && isOp\(me\)\) redirect\('\/owner\/dashboard'\)/.test(staffHome))
check('the switch is a slider at the top: instant, the URL keeps the view (replaceState), nothing stored, only the open view mounted', /history\.replaceState/.test(read('src/components/dashboard/LensTabs.tsx')) && /panels\[lens\]/.test(read('src/components/dashboard/LensTabs.tsx')) && /position: sticky/.test(read('src/components/app/app.css')) && !/router\.replace/.test(read('src/components/dashboard/LensTabs.tsx')))
check('it is a real tablist: arrow keys, Home/End, roving tabindex', /role="tablist"/.test(read('src/components/dashboard/LensTabs.tsx')) && /ArrowRight/.test(read('src/components/dashboard/LensTabs.tsx')) && /tabIndex=\{l\.id === lens \? 0 : -1\}/.test(read('src/components/dashboard/LensTabs.tsx')))
check('the dev view holds health, the alert test bench, test checklists, the legend of prefixes and the reference links', /readDevHealth\(\)/.test(dev) && /<DevPushPanel/.test(dev) && /preview=opening/.test(dev) && /AUDIENCE_PREFIX/.test(dev) && /supabase\.com\/dashboard\/project\//.test(dev))
const health = read('src/lib/owner/dev-health.ts')
check('the health check judges migrations by the OBJECT they create (the four from this month included)', ['staff_time_off', 'checklist_issue_resolutions', 'checklist_branch_settings', 'checklist_lead', 'push_sent_at'].every((o) => health.includes(`'${o}'`)) && /staff_push_cron_status/.test(health))
check('the health check reads only (no insert, update or delete)', !/\.(insert|update|delete|upsert)\(/.test(health))

section('the employee and owner dashboard bodies')
const empView = read('src/components/dashboard/EmployeeDashboardView.tsx')
const ownView = read('src/components/dashboard/OwnerDashboardView.tsx')
check('employees see, in the owner order of 2026-10-17: alerts, then the shift card, then the workshop, then their own area', empView.indexOf('{alerts}') > 0 && empView.indexOf('{alerts}') < empView.indexOf('<ShiftStatusCard') && empView.indexOf('<ShiftStatusCard') < empView.indexOf('<WorkshopCard') && empView.indexOf('<WorkshopCard') < empView.indexOf('app-account'))
check('there is no separate "my shift" list under the card: the shift card is the one door to the checklists and the schedule', !/title: 'המשמרת שלי'/.test(empView) && !/label: 'צ׳קליסטים למשמרת'/.test(empView) && /scheduleHref=\{scheduleHref\}/.test(empView))
check('the app home no longer offers "add to Home Screen" (the gate already did); the code dashboard does', !/InstallAppButton/.test(empView) && /InstallAppButton/.test(read('src/components/dashboard/CodeDashboardView.tsx')))
check('a general manager sees the shortages list from their shift screen', /href: '\/owner\/issues'/.test(empView))
check('owners see alerts, then the live pulse, then the two cards they open most, before the categories', ownView.indexOf('<DashboardNotifications') < ownView.indexOf('<DashboardLive') && ownView.indexOf('<DashboardLive') < ownView.indexOf('app-attention') && ownView.indexOf('app-attention') < ownView.indexOf('<DashboardSections'))
check('the branch manager is one tap from the owner dashboard', /href="\/owner\/branches"/.test(ownView))
check('the developer\'s alerts carry their audience, everyone else\'s do not', /alertTitle\(row\.kind \?\? '', row\.title, \{ developer \}\)/.test(ownView) && /alertTitle\(row\.kind \?\? '', row\.title, \{ developer \}\)/.test(empView))

section('the branch manager')
const middleware = read('src/middleware.ts')
check('it is owner-only at the door, in both pages and in the API', /OP_ONLY_PREFIXES = \[[^\]]*'\/owner\/branches'/.test(middleware) && /isOp\(me\)\) redirect\('\/no-access'\)/.test(read('src/app/owner/branches/page.tsx')) && /isOp\(me\)\) redirect\('\/no-access'\)/.test(read('src/app/owner/branches/[slug]/page.tsx')) && /requireOwner\(\)/.test(read('src/app/api/owner/branches/checklists/route.ts')))
const api = read('src/app/api/owner/branches/checklists/route.ts')
const mig = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('_branch_manager_checklists_constraints.sql')).map((f) => read(`supabase/migrations/${f}`)).join('\n')
check('the API calls the one database function, with the actor from the session', /rpc\('checklist_set_branch_kind', \{ p_actor: owner\.id, p_branch: body\.branchId, p_kind: body\.kind, p_enabled: body\.enabled \}\)/.test(api) && /\.strict\(\)/.test(api))
check('that function exists once, with exactly that signature, and only the service role may run it', /create or replace function public\.checklist_set_branch_kind\(p_actor uuid, p_branch uuid, p_kind text, p_enabled boolean\)/.test(mig) && /revoke all on function public\.checklist_set_branch_kind\(uuid, uuid, text, boolean\) from public, anon, authenticated/.test(mig) && /grant execute on function public\.checklist_expected\(uuid\), public\.checklist_set_branch_kind\(uuid, uuid, text, boolean\) to service_role/.test(mig))
check('the table is closed to browser roles', /alter table public\.checklist_branch_settings enable row level security/.test(mig) && /revoke all on public\.checklist_branch_settings from public, anon, authenticated/.test(mig))
check('the migration is additive and idempotent (no drop table, no destructive alter)', !/drop table|truncate/i.test(mig) && /create table if not exists/.test(mig))
const bm = read('src/components/branches/BranchManager.tsx')
check('six tabs: overview, checklists, schedule, details, team, and the POS', ['overview', 'checklists', 'schedule', 'details', 'team', 'pos'].every((t) => bm.includes(`id: '${t}'`)))
check('the readiness list jumps to the tab where each thing is fixed', /onClick=\{\(\) => go\(item\.tab\)\}/.test(bm) && read('src/lib/branches/manager.ts').includes("tab: 'schedule'") && read('src/lib/branches/manager.ts').includes("tab: 'checklists'"))
check('a checklist switch shows the change at once and puts it back with a sentence if the server says no', /setState\(before\)/.test(bm) && /role="switch"/.test(bm) && /aria-checked=\{item\.enabled\}/.test(bm))
const embedded = read('src/components/branches/ScheduleSettings.tsx')
check('the scheduler\'s settings are embedded with their own draft and one Save (nothing is edited in two places), mounted only once the schedule has loaded', /<ScheduleSettings branchSlug=\{state\.slug\} \/>/.test(bm) && /<SettingsDraftProvider>/.test(embedded) && /<ManagerPanel \/>/.test(embedded) && /<SettingsSaveBar \/>/.test(embedded) && /if \(!db\) \{/.test(embedded) && /scheduleSeen/.test(bm))
check('the tab lives in the URL, so a refresh or a shared link keeps it', /searchParams\.set\('tab', next\)/.test(bm) && /TABS = \['overview', 'checklists', 'schedule', 'details', 'team', 'pos'\]/.test(read('src/app/owner/branches/[slug]/page.tsx')))
const overview = read('src/lib/branches/manager.ts')
check('a switched-off checklist is read as off only while the switch says so (default on, nothing set = on)', /sw \? sw\.enabled === true : true/.test(overview))
check('the list page can add a branch and goes straight to its manager', /<AddBranchSheet/.test(read('src/components/branches/BranchList.tsx')) && /router\.push\(`\/owner\/branches\/\$\{branch\.slug\}\?tab=overview`\)/.test(read('src/components/branches/BranchList.tsx')))

section('the limits an employee works within (אילוצים)')
const portal = read('src/components/shifts/TimeOffPortal.tsx')
check('the three options per day are the owner\'s words', /לא יכול\/ה משמרת בוקר/.test(portal) && /לא יכול\/ה משמרת ערב/.test(portal) && /יום חופש כל היום/.test(portal))
check('a day takes ONE choice: it replaces, never adds (so a day is one shift or the whole day)', /chooseKind\(prev\[date\] \?\? \[\], kind\)/.test(portal) && /multiChoiceDay\(after, before\) !== null\) throw refusal\('one_choice_per_day'\)/.test(read('src/lib/shifts/dispatch-write.ts')))
check('the form counts down what is left and disables what would break a limit', /daysOffLeftText/.test(portal) && /blocksLeftText/.test(portal) && /canAdd\(wanted, date, kind, limits\)/.test(portal))
check('one send button carries the wishes and the note', /שליחת האילוצים/.test(portal) && /type: 'submitTimeOff'/.test(portal) && /type: 'submitAvailability'/.test(portal))
const dispatch = read('src/lib/shifts/dispatch-write.ts')
check('the server checks the limits against what the week will hold after the save', /breaks\(countWanted\(after\), countWanted\(before\), limitsOf\(/.test(dispatch) && /throw refusal\(broken\)/.test(dispatch))
const panel = read('src/components/shifts/ManagerPanel.tsx')
check('the manager sets both limits in the scheduler settings (and so in the branch manager)', /<ConstraintLimits \/>/.test(panel) && /maxDaysOff/.test(read('src/components/shifts/ConstraintLimits.tsx')) && /maxShiftBlocks/.test(read('src/components/shifts/ConstraintLimits.tsx')))
check('the block limit starts as "no limit"', /unlimited = blocks === null/.test(read('src/components/shifts/ConstraintLimits.tsx')))


// ---------------------------------------------------------------------------------------------------------------------
section('checklists belong to a branch: ONE builder per branch, under its manager (2026-10-16)')
writeFileSync(join(dir, 'links.mjs'), ts.transpileModule(read('src/lib/checklists/links.ts'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText)
const LK = await import(pathToFileURL(join(dir, 'links.mjs')).href)
eq('the builder address names the branch and the form', LK.branchChecklistBuilderPath('maor', 'opening'), '/owner/branches/maor/checklists/opening')
check('only that shape (and the bare parent) is a builder address: nothing else under /owner/branches is let through the manager door',
  ['/owner/branches/maor/checklists/opening', '/owner/branches/givat-haviva/checklists/closing', '/owner/branches/maor/checklists'].every((v) => LK.isBranchChecklistBuilderPath(v))
  && ['/owner/branches', '/owner/branches/maor', '/owner/branches/maor/checklists/other', '/owner/branches/maor/checklists/opening/x', '/owner/branches/../checklists/opening', '/owner/branches/Maor/checklists/opening', '//owner/branches/maor/checklists/opening', '/owner/branches/maor/checklists/opening?x=1'].every((v) => !LK.isBranchChecklistBuilderPath(v)))
const mw = read('src/middleware.ts')
check('middleware treats the builder as menu-editor access (owner or general manager), not owner-only, and keeps its address through sign-in',
  /const checklistBuilder = isBranchChecklistBuilderPath\(pathname\)/.test(mw) && /editorProtected = checklistBuilder \|\|/.test(mw) && /opProtected = !checklistBuilder &&/.test(mw) && /isOwnerChecklistPath\(pathname\) \|\| checklistBuilder/.test(mw))
const builderPage = read('src/app/owner/branches/[slug]/checklists/[kind]/page.tsx')
check('the page decides the branch: only canEditMenu for THAT branch gets in, events have no forms, a signed-out visitor returns here',
  /canEditMenu\(me, branch\.id\)/.test(builderPage) && /branch\.kind === 'event'\) notFound\(\)/.test(builderPage) && /redirect\(`\/login\?next=\$\{branchChecklistBuilderPath/.test(builderPage) && /hasAnyMenuEditAccess\(me\)/.test(builderPage))
check('a branch with no forms gets a working set on the way in (a new branch starts from something)', /ensureChecklistTemplates\(service,/.test(builderPage))
const publishApi = read('src/app/api/owner/checklists/route.ts')
check('publishing is for the owner or THAT branch\'s general manager (requireMenuEditor on the body\'s branch); every other action stays owner-only',
  /requireMenuEditor\(body\.branchId\)/.test(publishApi) && /const owner = await requireOwner\(\)/.test(publishApi) && publishApi.indexOf('requireMenuEditor') < publishApi.indexOf('const owner = await requireOwner()'))
const builder = read('src/components/checklists/ChecklistBuilder.tsx')
check('the builder publishes only the branch it was opened for', /branchId: branch\.id, kind, name: draftName\.trim\(\)/.test(builder) && !/branchId: (?!branch\.id)/.test(builder))
check('the form keeps the name its builder gave it (no branch name is added) and the draft survives a reload', /name: draftName\.trim\(\)/.test(builder) && !/\$\{branch\.name\}\s*[·–-]\s*\$\{draftName/.test(builder) && /localStorage\.setItem\(draftKey/.test(builder))
check('a new branch can start from another branch\'s form (a draft, published only on purpose)', /copyFromBranch/.test(builder) && /structuredClone\(template\.definition\)/.test(builder) && !/publish\(\)[^}]*copyFromBranch/.test(builder))
const manager = read('src/components/branches/BranchManager.tsx')
check('"edit" in the branch manager opens THAT form\'s builder directly, not the shared page', /branchChecklistBuilderPath\(state\.slug, item\.kind\)/.test(manager) && !/עריכת הטופס ומעקב/.test(manager))
const tracker = read('src/components/checklists/OwnerChecklistWorkspace.tsx')
check('the shared checklists page is the tracker and the report only: the builder is gone from it, with a pointer to the branch', !/builder/.test(tracker) && !/action: 'publish'/.test(tracker) && /\/owner\/branches\/\$\{branch\}\?tab=checklists/.test(tracker))
const mgr = read('src/lib/branches/manager.ts')
check('the branch manager lists each form under the name that branch gave it', /select\('kind, name, version, published_at'\)/.test(mgr) && /label: \(template\?\.name as string \| undefined\)\?\.trim\(\) \|\| KIND_LABELS\[kind\]/.test(mgr))
const serverLib = read('src/lib/checklists/server.ts')
check('employees read the branch\'s own form names (list, shift card, test previews)', /export async function checklistNames/.test(serverLib) && /names\.get\(`\$\{branch\.id\}\|\$\{kind\}`\)/.test(serverLib) && /checklistNames\(service, branchIds\)/.test(read('src/lib/staff/shift-status.ts')) && /String\(row\.name \?\? ''\)\.trim\(\)/.test(read('src/app/api/checklists/route.ts')))
const stdNames = ['פתיחת משמרת', 'החלפת משמרת', 'סגירת משמרת']
const defaults = read('src/lib/checklists/defaults.ts')
check('the standard form names carry no branch name, so a new branch starts with "פתיחת משמרת", not "פתיחת משמרת מאור"', stdNames.every((n) => defaults.includes(n)) && !/checklistName[\s\S]{0,200}(מאור|גבעת חביבה|branch)/.test(defaults.slice(defaults.indexOf('checklistName'), defaults.indexOf('checklistName') + 300)))

section('the developer\'s notification centre: three containers (2026-10-16)')
const centre = read('src/components/staff/DevNotificationCenter.tsx')
check('three containers in the owner\'s order: developer, management, employee', /id: 'developer'[\s\S]*id: 'owner'[\s\S]*id: 'employee'/.test(centre) && /התראות מפתח/.test(centre) && /התראות הנהלה/.test(centre) && /התראות עובד/.test(centre))
check('every alert opens the thing it is about (the push resolver, with the manager door open for the owner-developer)', /href: pushPathFor\(kind, link, \{ manager: true, title \}\)/.test(read('src/lib/push/dev-centre.ts')) && /<Link href=\{row\.href\}/.test(centre))
check('each alert says what the push service did with it ("reached 2 of 2 phones", "no phone registered")', /deliveryText\(row\.push\)/.test(centre) && /אין מכשיר רשום/.test(centre))
check('mark-all and mark-one write through the developer-only route', /\/api\/staff\/dev\/notifications/.test(centre) && /isDeveloper\(me\)\) throw Forbidden/.test(read('src/app/api/staff/dev/notifications/route.ts')) && /\.eq\('staff_id', me\.id\)/.test(read('src/app/api/staff/dev/notifications/route.ts')))
check('it is a fourth view of the developer\'s dashboard with an unread badge that follows what is read', /alerts: <DevNotificationCenter/.test(dev) && /badges=\{\{ alerts:/.test(dev) && /sarcafe:lens-badge/.test(centre) && /sarcafe:lens-badge/.test(read('src/components/dashboard/LensTabs.tsx')))
check('the centre reads only the developer\'s OWN alerts', /\.eq\('staff_id', staffId\)/.test(read('src/lib/push/dev-centre.ts')))

section('the employee home (2026-10-16)')
const employee = read('src/components/dashboard/EmployeeDashboardView.tsx')
check('quick orders say "coming soon, in development" and the event register "next festival": on the page, not links', /label: 'הזמנות מהירות'[^\n]*soon: 'בקרוב · בפיתוח'/.test(employee) && /label: 'קופת אירועים ועמדות'[^\n]*soon: 'בפסטיבל הבא :\)'/.test(employee) && /entry\.soon \|\| !entry\.href/.test(read('src/components/app/DashboardSections.tsx')))
check('the employee still reaches their schedule (through the shift card) and their own profile on the home page', /scheduleHref=\{scheduleHref\}/.test(employee) && /href="\/staff\/profile"/.test(employee))
check('the staff menu shows the register as "next festival" too, not as a way in', /soon: 'בפסטיבל הבא :\)'/.test(read('src/components/app/AppNavigation.tsx')) && /item\.soon/.test(read('src/components/app/AppNavigation.tsx')))
const attention = read('src/components/app/app.css')
check('the two owner cards no longer touch the request row above them', /\.app-attention \{[^}]*margin-block: 16px 24px/.test(attention))

section('the gate screen has its own ground and its own buttons (2026-10-16)')
const gateTsx = read('src/components/staff/NotificationsGate.tsx')
const gateCss = read('src/components/staff/gate.css')
check('it sits on the brand\'s own artwork (both sizes), shaded to the app\'s ground', /backdrops\/maor-1-portrait\.webp/.test(gateCss) && /backdrops\/maor-1-wide\.webp/.test(gateCss) && /\.gate-shade/.test(gateCss) && /className="gate-scene"/.test(gateTsx))
check('its buttons are its own: it never depends on schedule.css being loaded (that was why they were bare text)', !/sch-btn/.test(gateTsx) && /\.gate-btn--primary/.test(gateCss) && /\.gate-btn \{/.test(gateCss))
check('the artwork files it names exist', ['maor-1-portrait.webp', 'maor-1-wide.webp'].every((f) => readdirSync(join(ROOT, 'public/backdrops')).includes(f)))
check('reduced motion switches its entrance off', /prefers-reduced-motion: reduce\) \{[^}]*\.gate-scene, \.gate/.test(gateCss))

section('constraints window, code dashboard and the cart sign-in (2026-10-17)')
const dispatchWrite = read('src/lib/shifts/dispatch-write.ts')
const guardAt = (name) => dispatchWrite.indexOf(`case '${name}'`)
check('an אילוצים send after the Tuesday is REFUSED by the server, not only hidden by the form', /async function requireRequestsOpen/.test(dispatchWrite) && /requestsOpen\(weekStart, now\)\) throw refusal\('requests_closed'\)/.test(dispatchWrite) && dispatchWrite.indexOf('requireRequestsOpen(service', guardAt('submitTimeOff')) > guardAt('submitTimeOff') && dispatchWrite.indexOf('requireRequestsOpen(service', guardAt('submitTimeOff')) < dispatchWrite.indexOf('sched_submit_time_off', guardAt('submitTimeOff')) && dispatchWrite.indexOf('requireRequestsOpen(service', guardAt('submitAvailability')) > guardAt('submitAvailability') && dispatchWrite.indexOf('requireRequestsOpen(service', guardAt('submitAvailability')) < guardAt('submitTimeOff'))
const availPortal = read('src/components/shifts/AvailabilityPortal.tsx')
const schCss = read('src/components/shifts/schedule.css')
check('a closed week shows a card (what was sent, go to next week) INSTEAD of the form, and the next-week arrow is highlighted', /closed \? \(\s*<ClosedWeekCard/.test(availPortal) && /<TimeOffPortal target=\{target\} \/>/.test(availPortal) && /sch-iconbtn--nudge/.test(availPortal) && /\.sch-iconbtn--nudge \{/.test(schCss) && /prefers-reduced-motion: reduce\) \{ \.sch-iconbtn--nudge/.test(schCss))
check('with no open shifts the request section says why nobody can ask to join', /אי אפשר לבקש להצטרף כרגע/.test(availPortal) && /choices\.length === 0/.test(availPortal))
const staffPage = read('src/app/staff/page.tsx')
check('/staff shows the app home to an app sign-in and the checklist dashboard to a six-digit-code sign-in', /fullLogin \? <EmployeeDashboardView me=\{me\} \/> : <CodeDashboardView me=\{me\} \/>/.test(staffPage))
const codeView = read('src/components/dashboard/CodeDashboardView.tsx')
check('the code dashboard is the shift card (schedule tap goes to the app sign-in) and the Home Screen row, nothing else', /<ShiftStatusCard[^>]*scheduleHref=\{CODE_SCHEDULE_HREF\}[^>]*codeMode/.test(codeView) && /CODE_SCHEDULE_HREF = '\/login\?next=\/staff\/schedule'/.test(codeView) && !/<(DashboardNotifications|WorkshopCard|StaffPushCard|DashboardSections|GoogleLinkPrompt)/.test(codeView))
const staffLayout = read('src/app/staff/layout.tsx')
check('a code sign-in is not stopped by the app set-up gate; an app sign-in still is', /codeSession \? 'off' : gateModeFor/.test(staffLayout))
const crew = read('src/app/crew/page.tsx') + read('src/app/crew/CrewLogin.tsx')
check('/crew is the public QR sign-in: number + code, then /staff; someone already in goes straight to /staff; not indexed', /<QuickLogin next="\/staff"/.test(crew) && /if \(me\) redirect\('\/staff'\)/.test(crew) && /index: false/.test(crew))
check('the shift card says when a checklist is unavailable', (read('src/components/staff/ShiftStatusCard.tsx').match(/אין צ׳קליסט זמין|הצ׳קליסטים יהיו זמינים ביום המשמרת|אין צ׳קליסט שממתין/g) ?? []).length >= 4)

console.log(`\n${pass > 0 && failures.length === 0 ? '✓' : '✗'} ${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1) }
