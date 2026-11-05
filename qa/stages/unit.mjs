// Stage 3 — unit: the pure rules behind the glass dashboards, run as the real TypeScript (transpiled, like scripts/check-*.mjs).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { createStage, assert } from '../lib/harness.mjs'

const MODULES = ['src/lib/tools/index.ts', 'src/lib/tools/search.ts', 'src/lib/tools/badges.ts', 'src/lib/team-message/rules.ts', 'src/lib/push/notice-tone.ts', 'src/lib/qa/report.ts', 'src/lib/staff/access.ts', 'src/lib/checklists/developer.ts', 'src/lib/nav/dock.ts']

function load(root) {
  const out = path.join(root, 'qa/.cache/unit')
  fs.rmSync(out, { recursive: true, force: true })
  for (const rel of MODULES) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8')
    // the app's "@/…" path alias, resolved inside this cache (only modules listed above can be required)
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
      .replace(/require\("@\/([^"]+)"\)/g, (_, rel) => `require(${JSON.stringify(path.join(out, 'src', rel))})`)
    const dest = path.join(out, rel.replace(/\.ts$/, '.js'))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, js)
  }
  const req = createRequire(path.join(out, 'x.js'))
  const get = (rel) => req(`./${rel.replace(/\.ts$/, '.js')}`)
  return { tools: get('src/lib/tools/index.ts'), search: get('src/lib/tools/search.ts'), badges: get('src/lib/tools/badges.ts'), rules: get('src/lib/team-message/rules.ts'), tone: get('src/lib/push/notice-tone.ts'), report: get('src/lib/qa/report.ts'), dock: get('src/lib/nav/dock.ts') }
}

export function unitStage(root) {
  const stage = createStage('unit', 'לוגיקה: החיפוש, ההודעות, הצבעים והדוח')
  let m
  const ctx = (roles, hour = 9, usage = {}) => ({ roles, hour, usage })
  const top = (q, roles, usage) => m.search.searchTools(q, ctx(roles, 9, usage))[0]?.entry.id

  stage.test('load', 'המודולים נטענים כקוד TypeScript אמיתי', 'unit', async () => { m = load(root); assert.ok(m.search.searchTools && m.rules.cleanMessage) }, { retry: false })

  // ── tool index ↔ access rules
  stage.test('index-unique', 'אינדקס הכלים: מזהים ייחודיים, כתובות פנימיות, קבוצות הבית קיימות', 'unit', async () => {
    const ids = m.tools.TOOLS.map((t) => t.id)
    assert.equal(new Set(ids).size, ids.length, 'duplicate ids')
    assert.deepEqual(m.tools.TOOLS.filter((t) => !t.href.startsWith('/') || t.href.startsWith('//')).map((t) => t.id), [], 'external href:')
    const missing = Object.values(m.tools.HOME_TOOL_GROUPS).flat().flatMap((g) => g.ids).filter((id) => !m.tools.toolById(id))
    assert.deepEqual(missing, [], 'home groups name unknown tools:')
  })
  stage.test('index-access', 'החיפוש לא מציע לאף אחד עמוד שהשרת יחסום בפניו (מול middleware.ts)', 'security', async () => {
    const mw = fs.readFileSync(path.join(root, 'src/middleware.ts'), 'utf8')
    const list = (name) => [...(mw.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`))?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1])
    const opOnly = list('OP_ONLY_PREFIXES')
    assert.ok(opOnly.length > 3, 'could not read OP_ONLY_PREFIXES')
    const under = (href, prefixes) => prefixes.some((p) => href.split(/[?#]/)[0] === p || href.startsWith(`${p}/`))
    const leaks = m.tools.TOOLS.filter((t) => !t.soon && under(t.href, opOnly) && t.roles.some((r) => r !== 'op' && r !== 'dev')).map((t) => `${t.id} → ${t.href} (${t.roles})`)
    assert.deepEqual(leaks, [], 'owner-only page offered to non-owners:')
    const staffSees = m.tools.TOOLS.filter((t) => m.tools.toolVisible(t, ['staff']) && t.href.startsWith('/owner/'))
    assert.deepEqual(staffSees.map((t) => t.id), [], 'employee offered an /owner page:')
    assert.ok(!m.tools.TOOLS.filter((t) => m.tools.toolVisible(t, ['manager', 'staff'])).some((t) => t.roles.length === 1 && t.roles[0] === 'dev'), 'dev tools leak')
  })
  // The dock lives in the layouts (DockHost) and shows on tab roots only; src/lib/nav/dock.ts decides who gets which tabs.
  stage.test('dock-plan', 'הסרגל התחתון: כל אחד מקבל את הלשוניות שלו, רק בעמודי הלשוניות, ואף לשונית של עובד/ת לא מובילה לעמוד בעלים', 'security', async () => {
    const d = m.dock
    const pick = (plan) => plan && { kind: plan.kind, home: plan.home }
    const owner = { role: 'owner', badge: null, via: 'google', quick: false }
    const gm = { role: 'staff', badge: 'general_manager', via: 'google', quick: false }
    const emp = { role: 'staff', badge: null, via: 'google', quick: false }
    const dev = { role: 'owner', badge: 'developer', via: 'google', quick: false }
    assert.equal(d.dockPlanFor(null, 'staff'), null, 'signed out')
    assert.equal(d.dockPlanFor({ ...emp, via: 'employee_code', quick: true }, 'staff'), null, 'a six-digit-code sign-in has no dock')
    assert.equal(d.dockPlanFor({ ...owner, quick: true }, 'owner'), null, 'a quick session has no dock')
    assert.deepEqual(pick(d.dockPlanFor(owner, 'owner')), { kind: 'manager', home: '/owner/dashboard' })
    assert.equal(d.dockPlanFor(owner, 'staff'), null, 'an owner visiting a /staff page gets no employee dock')
    assert.deepEqual(pick(d.dockPlanFor(gm, 'staff')), { kind: 'employee', home: '/staff' })
    assert.equal(d.dockPlanFor(gm, 'owner'), null, 'a general manager on an /owner page gets no owner dock')
    assert.deepEqual(pick(d.dockPlanFor(emp, 'staff')), { kind: 'employee', home: '/staff' })
    assert.deepEqual(pick(d.dockPlanFor(dev, 'staff')), { kind: 'manager', home: '/staff/dev' })
    const ep = d.dockPlanFor(emp, 'staff')
    for (const p of ['/staff', '/staff/schedule', '/staff/checklists', '/staff/profile']) assert.ok(d.onDockRoot(ep, p), `employee dock on ${p}`)
    for (const p of ['/staff/onboarding', '/staff/checklists/abc', '/staff/schedule/givat-haviva', '/staff/pos', '/staff/dev', '/owner/dashboard']) assert.ok(!d.onDockRoot(ep, p), `no employee dock on ${p}`)
    const op = d.dockPlanFor(owner, 'owner')
    for (const p of ['/owner/dashboard', '/owner/schedule', '/owner/staff', '/owner/checklists']) assert.ok(d.onDockRoot(op, p), `owner dock on ${p}`)
    for (const p of ['/owner/kiosk', '/owner/schedule/print', '/owner/checklists/x', '/owner/editor']) assert.ok(!d.onDockRoot(op, p), `no owner dock on ${p}`)
    // the employee tabs never lead to an owner-only page (the middleware's list)
    const mw = fs.readFileSync(path.join(root, 'src/middleware.ts'), 'utf8')
    const opOnly = [...(mw.match(/const OP_ONLY_PREFIXES = \[([\s\S]*?)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1])
    assert.ok(opOnly.length > 3, 'could not read OP_ONLY_PREFIXES')
    const roots = ep.roots.map((re) => re.replace(/^\^|\$$/g, ''))
    assert.deepEqual(roots.filter((r) => opOnly.some((pfx) => r === pfx || r.startsWith(`${pfx}/`))), [], 'employee tab on an owner-only page')
  })
  stage.test('roles-for', 'תפקידים לפי מי שמחובר: בעלים, מנהל/ת סניף, עובד/ת, מפתח', 'unit', async () => {
    assert.deepEqual(m.tools.toolRolesFor({ op: true, manager: true, developer: false }), ['op', 'manager'])
    assert.deepEqual(m.tools.toolRolesFor({ op: false, manager: true, developer: false }), ['manager', 'staff'])
    assert.deepEqual(m.tools.toolRolesFor({ op: false, manager: false, developer: true }), ['staff', 'dev'])
  })

  // ── search engine
  stage.test('search-hebrew', 'חיפוש בעברית: התאמה, תחילית ה/ב/ל, שגיאות כתיב, אנגלית ומילים נרדפות', 'unit', async () => {
    const owner = ['op', 'manager']
    assert.equal(top('סידור', owner), 'schedule-manage')
    assert.equal(top('בסידור', owner), 'schedule-manage', 'prefix ב')
    assert.equal(top('סדיור', owner), 'schedule-manage', 'typo')
    assert.equal(top('menu', owner), 'menu-editor', 'english')
    assert.equal(top('משלוח חלב', owner), 'compose', 'partial words')
    assert.equal(top('תלוש', ['staff']), 'payslip')
    assert.equal(top('תלוש', owner), 'staff-list')
    assert.ok(!m.search.searchTools('תלוש', ctx(owner)).some((r) => r.entry.id === 'payslip'), 'an owner is not offered employee-only tools')
    assert.ok(m.search.searchTools('תלוש', ctx(['manager', 'staff'])).some((r) => r.entry.id === 'payslip'), 'a general manager keeps their own tools')
    assert.equal(top('החלפה', ['staff']), 'swap')
    assert.equal(m.search.searchTools('xqzw', ctx(owner)).length, 0, 'nonsense finds nothing')
  })
  stage.test('search-complete', 'השלמה אוטומטית והצעה "התכוונת ל"', 'unit', async () => {
    assert.equal(m.search.completeTools('סיד', ctx(['op', 'manager']))[0], 'סידור עבודה')
    assert.equal(m.search.didYouMean('סדור עבדה', ctx(['op', 'manager'])), 'סידור עבודה')
    assert.equal(m.search.didYouMean('zzzz', ctx(['op'])), null)
  })
  stage.test('search-context', 'הצעות לפי שעה, תפקיד והיסטוריה (צ׳קליסט פתיחה בבוקר, סגירה בערב)', 'unit', async () => {
    assert.equal(m.search.suggestTools(ctx(['staff'], 8))[0].entry.id, 'checklist-open')
    assert.equal(m.search.suggestTools(ctx(['staff'], 21))[0].entry.id, 'checklist-close')
    const usage = { workshop: { n: 40, t: Date.now() - 60_000 } }
    assert.ok(m.search.suggestTools(ctx(['staff'], 13, usage)).slice(0, 2).some((h) => h.entry.id === 'workshop'), 'heavy use rises')
    assert.ok(!m.search.suggestTools(ctx(['staff'], 13)).some((h) => h.entry.roles.every((r) => r === 'op')), 'employees never get owner tools')
  })
  stage.test('search-clean', 'מה שנשמר מחיפוש מנוקה (תווי כיוון ובקרה, אורך)', 'security', async () => {
    assert.equal(m.search.cleanQuery('‮סידור\u0000'), 'סידור')
    assert.equal(m.search.cleanQuery('א'), null)
    assert.equal(m.search.cleanQuery('x'.repeat(200)).length, 60)
    assert.equal(m.search.cleanQuery(42), null)
  })

  // ── team message rules
  stage.test('message-clean', 'הודעה לצוות: מנוקה מתווים מוסתרים וזיוף כיוון, עד 280 תווים', 'security', async () => {
    const c = m.rules.cleanMessage
    assert.equal(c('  מגיע   משלוח\nחלב  '), 'מגיע משלוח חלב')
    assert.equal(c('שלום‮םלוש'), 'שלוםםלוש', 'RTL override removed')
    assert.equal(c('a​b﻿c'), 'abc', 'zero-width removed')
    assert.equal(c('   '), null)
    assert.equal(c('x'.repeat(281)), null)
    assert.equal(c('x'.repeat(280))?.length, 280)
    assert.equal(c('☕ קפה ✓'), '☕ קפה ✓', 'emoji kept')
    assert.equal(c(null), null)
  })
  stage.test('message-title', 'כותרת ההודעה: שם השולח בלבד, בלי תווים מוסתרים', 'unit', async () => {
    assert.equal(m.rules.messageTitle('גלית'), 'הודעה מגלית')
    assert.equal(m.rules.messageTitle(null), 'הודעה מההנהלה')
    assert.equal(m.rules.messageTitle('‮גלית​'), 'הודעה מגלית')
  })
  stage.test('message-window', 'אפשר לכוון למשמרת מאתמול ועד שבועיים קדימה בלבד', 'unit', async () => {
    const t = '2026-11-05'
    assert.ok(m.rules.shiftDateAllowed('2026-11-04', t))
    assert.ok(!m.rules.shiftDateAllowed('2026-11-03', t))
    assert.ok(m.rules.shiftDateAllowed('2026-11-19', t))
    assert.ok(!m.rules.shiftDateAllowed('2026-11-20', t))
  })
  stage.test('message-team', '"כל הצוות": עובדי הסניף ועובדי כל הסניפים, בלי מי שכובה בסניף ובלי לא פעילים', 'unit', async () => {
    const off = new Set(['x'])
    assert.ok(m.rules.inBranchTeam({ branch_id: 'b', active: true }, 'b', off, 'a'))
    assert.ok(m.rules.inBranchTeam({ branch_id: null, active: true }, 'b', off, 'a'))
    assert.ok(!m.rules.inBranchTeam({ branch_id: 'c', active: true }, 'b', off, 'a'))
    assert.ok(!m.rules.inBranchTeam({ branch_id: null, active: true }, 'b', off, 'x'), 'switched off')
    assert.ok(!m.rules.inBranchTeam({ branch_id: 'b', active: false }, 'b', off, 'a'), 'inactive')
  })
  stage.test('message-summary', 'השורה "יישלח ל…" אומרת בדיוק מי יקבל ומי לא', 'unit', async () => {
    const s = m.rules.summaryLine
    assert.match(s({ audience: 'all', branchName: 'מאור', reachable: 3, total: 5 }), /ל־3 עובדים במאור .*2 לא הפעילו התראות/)
    assert.match(s({ audience: 'shift', branchName: 'x', reachable: 0, total: 2, shiftName: 'm' }), /אף אחד/)
    assert.match(s({ audience: 'one', branchName: 'x', reachable: 1, total: 1, person: 'דנה' }), /רק ל־דנה/)
  })

  // ── tones and pills
  stage.test('tones', 'התראות חיוביות בירוק ושליליות באדום (לפי סוג, ואם אין — לפי הכותרת)', 'unit', async () => {
    const t = m.tone.noticeTone
    assert.equal(t('schedule.published', ''), 'ok')
    assert.equal(t('swap.declined', ''), 'bad')
    assert.equal(t('timeoff.decided', 'יום החופש אושר'), 'ok')
    assert.equal(t('timeoff.decided', 'בקשת יום החופש נדחתה'), 'bad')
    assert.equal(t('staff.message', 'הודעה מגלית'), 'neutral')
    assert.equal(t('checklist.late', ''), 'bad')
  })
  stage.test('badges', 'הגלולות ("2 בקשות") מוצגות רק כשיש מספר אמיתי', 'unit', async () => {
    const b = m.badges.toolBadges
    const stats = { outOfStockCount: { known: true, value: 2 }, hasUnpublishedChanges: { known: true, value: true }, categoryCount: { known: true, value: 4 } }
    const out = b({ stats, shortages: 3, requests: 2 })
    assert.equal(out['schedule-manage'], '2 בקשות')
    assert.equal(out.issues, '3 לטיפול')
    assert.equal(out['tablet-avail'], '2 אזלו')
    assert.deepEqual(b({ stats: { outOfStockCount: { known: false, value: 0 }, hasUnpublishedChanges: { known: false, value: false } }, shortages: null, requests: 0 }), {}, 'unknown numbers make no pill')
  })
  stage.test('report-contract', 'חוזה הדוח: הדוח שנשלח עם הקוד תקין, ושדה לא מוכר נדחה', 'unit', async () => {
    const shipped = JSON.parse(fs.readFileSync(path.join(root, 'qa/reports/latest.json'), 'utf8'))
    const ok = m.report.QaReport.safeParse(shipped)
    assert.ok(ok.success, ok.success ? '' : JSON.stringify(ok.error.issues.slice(0, 3)))
    assert.ok(!m.report.QaReport.safeParse({ ...shipped, extra: 1 }).success, 'unknown key accepted')
    const huge = structuredClone(shipped); huge.review.headline = 'x'.repeat(5000)
    assert.ok(!m.report.QaReport.safeParse(huge).success, 'oversize accepted')
  })
  return stage
}
