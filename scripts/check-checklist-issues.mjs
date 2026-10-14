// Checks for the owner's "missing or not working" report: the real issues.ts (transpiled), the loader and API that
// feed it, the morning alert and where the owner finds it.
//
//   node scripts/check-checklist-issues.mjs

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

const dir = mkdtempSync(join(tmpdir(), 'check-checklist-issues-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp dir */ } })
const load = async (file, name) => {
  writeFileSync(join(dir, name), ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText)
  return import(pathToFileURL(join(dir, name)).href)
}
const I = await load('src/lib/checklists/issues.ts', 'issues.mjs')
const R = await load('src/lib/push/staff-rules.ts', 'rules.mjs')

// A submitted checklist: who, when, what was reported and what was answered "fine".
let n = 0
const row = (staff, date, hour, issues = [], okItems = [], extra = {}) => ({
  id: `c${++n}`, staffId: staff.toLowerCase(), staffName: staff, shiftDate: date, startTime: '07:30', endTime: '13:00', kind: 'opening',
  submittedAt: `${date}T${hour}:00.000Z`, issues, okItems, handled: false, ...extra,
})
const ice = (reason) => ({ itemId: 'O05-machine', label: 'מכונת הקרח והמלאי בה תקינים', category: 'קרח ואייס', type: 'equipment', reason })
const oat = (reason) => ({ itemId: 'O17-oat', label: 'יש חלב שיבולת שועל', category: 'חומרי הכנה וחלב', type: 'inventory', reason })

section('one card per CHECK, however many people reported it')
const week = [
  row('Dana', '2030-01-07', '05:40', [ice('לא מקררת')]),
  row('Eli', '2030-01-08', '05:35', [ice('עדיין מקולקלת'), oat('נגמר')]),
  row('Dana', '2030-01-09', '05:50', [ice('הטכנאי עוד לא הגיע')]),
  row('Noa', '2030-01-09', '10:00', [], ['O17-oat']),
]
const week1 = I.buildIssueReport(week)
check('the ice machine is ONE group with three reports (not three checklists)', week1.open.length === 1 && week1.open[0].itemId === 'O05-machine' && week1.open[0].reports.length === 3, JSON.stringify(week1.open.map((g) => [g.itemId, g.reports.length])))
const iceGroup = week1.open.find((g) => g.itemId === 'O05-machine')
eq('who reported it, newest first, with their reasons', iceGroup.reports.map((r) => [r.staffName, r.shiftDate, r.reason]), [['Dana', '2030-01-09', 'הטכנאי עוד לא הגיע'], ['Eli', '2030-01-08', 'עדיין מקולקלת'], ['Dana', '2030-01-07', 'לא מקררת']])
eq('people and days are counted as different people / different days', [iceGroup.people, iceGroup.days], [2, 3])
check('each report carries the shift and the time it was sent', iceGroup.reports[0].startTime === '07:30' && iceGroup.reports[0].submittedAt === '2030-01-09T05:50:00.000Z' && iceGroup.reports[0].kind === 'opening')
eq('the summary says how loud it is', I.issueSummary(iceGroup), 'דווח 3 פעמים · 2 עובדים · ב־3 ימים')
eq('a single report is told plainly', I.issueSummary({ reports: [1], people: 1, days: 1 }), 'דווח פעם אחת')
check('the check that a later checklist answered "fine" is quiet: recovered, not open', week1.recovered.length === 1 && week1.recovered[0].itemId === 'O17-oat' && week1.recovered[0].recoveredAt === '2030-01-09T10:00:00.000Z' && !week1.open.some((g) => g.itemId === 'O17-oat'))
check('the worst problem is first', I.buildIssueReport([...week, row('Gil', '2030-01-10', '05:00', [oat('נגמר שוב')])]).open[0].itemId === 'O05-machine')

section('handled: the owner closes it, a new report opens it again')
const closed = I.buildIssueReport(week, { 'O05-machine': '2030-01-09T06:00:00.000Z' })
check('marking it handled closes every report made until then', !closed.open.some((g) => g.itemId === 'O05-machine'))
const again = I.buildIssueReport([...week, row('Eli', '2030-01-10', '05:30', [ice('שוב מקולקלת')])], { 'O05-machine': '2030-01-09T06:00:00.000Z' })
eq('a report made after that opens it again, with only the new one', again.open.find((g) => g.itemId === 'O05-machine').reports.map((r) => r.shiftDate), ['2030-01-10'])
check('a report made at the very moment of the mark is closed by it (not left dangling)', I.buildIssueReport([row('Dana', '2030-01-09', '06:00', [ice('x')])], { 'O05-machine': '2030-01-09T06:00:00.000Z' }).open.length === 0)
check('the older whole-checklist "handled" mark still hides that checklist\'s reports', I.buildIssueReport([row('Dana', '2030-01-07', '05:40', [ice('x')], [], { handled: true })]).open.length === 0)
check('a check that is OK again but was reported later is not hidden by an earlier OK', I.buildIssueReport([row('Dana', '2030-01-07', '05:00', [], ['O05-machine']), row('Eli', '2030-01-08', '05:00', [ice('x')])]).open.length === 1)
check('nothing reported, nothing in the report', I.buildIssueReport([row('Dana', '2030-01-07', '05:40', [], ['O05-machine'])]).open.length === 0)

section('what the owner reads')
check('every kind of issue has a plain label', ['inventory', 'equipment', 'cleanliness', 'cash', 'other'].every((t) => typeof I.ISSUE_TYPE_LABELS[t] === 'string'))
check('the cash check keeps the counted amount and the target', (() => {
  const g = I.buildIssueReport([row('Dana', '2030-01-07', '19:40', [{ itemId: 'C13', label: 'ספירת קופה', category: 'קופה ויציאה', type: 'cash', reason: 'חסרו 20 ₪', value: 380, target: 400 }])]).open[0]
  return g.reports[0].value === 380 && g.reports[0].target === 400
})())

section('the morning alert')
check('the digest goes out at 08:00 and for three hours after (the scheduler may have been down)', R.ISSUES_DIGEST_HOUR === 8 && R.issuesDigestDue({ date: '2030-01-07', time: '08:00' }) && R.issuesDigestDue({ date: '2030-01-07', time: '10:59' }))
check('not before 08:00 and not from 11:00', !R.issuesDigestDue({ date: '2030-01-07', time: '07:59' }) && !R.issuesDigestDue({ date: '2030-01-07', time: '11:00' }))
const reminders = read('src/lib/push/staff-reminders.ts')
check('it is written once per owner per branch per day (the dedupe key carries the branch and the date)', /issues-digest:\$\{branchId\}:\$\{branch\.clock\.date\}/.test(reminders))
check('it is written only when something is open', /report\.open\.length === 0\) continue/.test(reminders))
check('it goes to every owner and developer, in the branch\'s own morning', /issuesDigestDue\(branch\.clock\)/.test(reminders) && /role\.eq\.owner,badge\.eq\.owner,badge\.eq\.developer/.test(reminders))
check('it opens that branch\'s report', /\/owner\/issues\$\{branch\.slug/.test(reminders))
check('its kind and path are routed (a stored plain path wins)', R.pushPathFor('issues.digest', { url: '/owner/issues?branch=givat-haviva' }) === '/owner/issues?branch=givat-haviva')
check('the scheduled run calls it with everything else', /issuesDigest\(service, clocks\)/.test(reminders))

section('where the owner finds it')
const dashboard = read('src/app/owner/dashboard/page.tsx')
check('the dashboard has its own category, first, with the count of open things', /title: 'חוסרים ותקלות'/.test(dashboard) && dashboard.indexOf("title: 'חוסרים ותקלות'") < dashboard.indexOf("title: 'צוות ומשמרות'") && /loadIssueReport\(service, defaultBranch\.id\)/.test(dashboard))
check('the page and the checklists tab show the same report', read('src/components/checklists/OwnerIssuesWorkspace.tsx').includes('<IssueReport') && read('src/components/checklists/OwnerChecklistWorkspace.tsx').includes('<IssueReport'))
check('the old "one card per checklist with its sum of NO answers" inbox is gone from the tracker', !read('src/components/checklists/OwnerChecklistWorkspace.tsx').includes('ck-issue-row') && !read('src/components/checklists/OwnerChecklistWorkspace.tsx').includes('const inbox'))
const middleware = read('src/middleware.ts')
check('the page is owner-only at the door as well as in the page and the API', /OP_ONLY_PREFIXES = \[[^\]]*'\/owner\/issues'/.test(middleware) && /requireOwner\(\)/.test(read('src/app/api/owner/issues/route.ts')) && /isOp\(me\)/.test(read('src/app/owner/issues/page.tsx')))
const api = read('src/app/api/owner/issues/route.ts')
check('marking handled is an insert (history is kept), by the owner, for a branch that exists', /from\('checklist_issue_resolutions'\)\.insert\(/.test(api) && /resolved_by: owner\.id/.test(api) && /\.eq\('id', body\.branchId\)/.test(api))
const loader = read('src/lib/checklists/issues-server.ts')
check('only SUBMITTED checklists count, from the last 45 days, newest marks win', /eq\('status', 'submitted'\)/.test(loader) && /ISSUE_REPORT_DAYS = 45/.test(loader) && /Newest mark per check wins/.test(loader))

console.log(`\n${pass > 0 && failures.length === 0 ? '✓' : '✗'} ${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1) }
