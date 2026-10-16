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

section('the developer\'s three views')
eq('manager, employee, developer, in the owner\'s order', L.LENSES.map((l) => l.id), ['manager', 'employee', 'dev'])
eq('the developer\'s own tools are the default', L.DEFAULT_LENS, 'dev')
eq('?view= is made safe', [L.parseLens('manager'), L.parseLens('employee'), L.parseLens('dev'), L.parseLens('nonsense'), L.parseLens(undefined), L.parseLens(['employee', 'x']), L.parseLens('<script>')], ['manager', 'employee', 'dev', 'dev', 'dev', 'employee', 'dev'])
eq('a developer who is not an owner has no manager view', L.lensesFor(false).map((l) => l.id), ['employee', 'dev'])
eq('an owner-developer has all three', L.lensesFor(true).map((l) => l.id), ['manager', 'employee', 'dev'])

section('one dashboard, no second place to be')
const dev = read('src/app/staff/dev/page.tsx')
const staffHome = read('src/app/staff/page.tsx')
const ownerHome = read('src/app/owner/dashboard/page.tsx')
check('the dev page is developer-only and checked on the server', /if \(!isDeveloper\(me\)\) redirect\('\/staff'\)/.test(dev))
check('the manager view needs a full (Google) owner login, so it never leads to a wall', /const canManage = fullLogin && isOp\(me\)/.test(dev) && /lensesFor\(canManage\)/.test(dev))
check('all three views are built on the server up front and handed to the switcher (switching is instant); the manager view only for a full owner login', /const panels: Parameters<typeof LensTabs>\[0\]\['panels'\] = \{/.test(dev) && /employee: <EmployeeDashboardView/.test(dev) && /dev: await DevPanel\(\)/.test(dev) && /\.\.\.\(canManage \? \{ manager: <OwnerDashboardView/.test(dev))
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
check('employees see what needs them first: the shift, then alerts, then set-up prompts', empView.indexOf('<ShiftStatusCard') < empView.indexOf('{unread > 0 && alerts}') && empView.indexOf('{unread > 0 && alerts}') < empView.indexOf('<GoogleLinkPrompt'))
check('the schedule row says אילוצים', /משמרות ואילוצים/.test(empView))
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

console.log(`\n${pass > 0 && failures.length === 0 ? '✓' : '✗'} ${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1) }
