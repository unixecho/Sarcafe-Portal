// Stage 3 — unit: the pure rules behind the glass dashboards, run as the real TypeScript (transpiled, like scripts/check-*.mjs).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { createStage, assert, startChecks } from '../lib/harness.mjs'
import { buildReport } from '../lib/report.mjs'

const MODULES = ['src/lib/tools/index.ts', 'src/lib/tools/search.ts', 'src/lib/tools/badges.ts', 'src/lib/team-message/rules.ts', 'src/lib/push/notice-tone.ts', 'src/lib/qa/report.ts', 'src/lib/staff/access.ts', 'src/lib/checklists/developer.ts', 'src/lib/nav/dock.ts', 'src/lib/kiosk/device-settings.ts', 'src/lib/kiosk/remote-rules.ts', 'src/lib/kiosk/pin-record.ts', 'src/lib/kiosk/stock.ts', 'src/lib/kiosk/enroll.ts', 'src/lib/kiosk/menu-edit.ts', 'src/lib/qa/digest.ts', 'src/lib/identity/types.ts', 'src/lib/identity/rules.ts', 'src/lib/identity/access.ts']

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
  return { tools: get('src/lib/tools/index.ts'), search: get('src/lib/tools/search.ts'), badges: get('src/lib/tools/badges.ts'), rules: get('src/lib/team-message/rules.ts'), tone: get('src/lib/push/notice-tone.ts'), report: get('src/lib/qa/report.ts'), dock: get('src/lib/nav/dock.ts'), remote: { ...get('src/lib/kiosk/remote-rules.ts'), ...get('src/lib/kiosk/pin-record.ts') }, digest: get('src/lib/qa/digest.ts'), stock: get('src/lib/kiosk/stock.ts'), enroll: get('src/lib/kiosk/enroll.ts'), menuEdit: get('src/lib/kiosk/menu-edit.ts'), identity: { ...get('src/lib/identity/rules.ts'), ...get('src/lib/identity/access.ts') } }
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
    for (const p of ['/owner/dashboard', '/owner/schedule', '/owner/staff', '/owner/checklists', '/owner/kiosk/control']) assert.ok(d.onDockRoot(op, p), `owner dock on ${p}`)
    for (const p of ['/owner/kiosk', '/owner/schedule/print', '/owner/checklists/x', '/owner/editor']) assert.ok(!d.onDockRoot(op, p), `no owner dock on ${p}`)
    // the employee tabs never lead to an owner-only page (the middleware's list)
    const mw = fs.readFileSync(path.join(root, 'src/middleware.ts'), 'utf8')
    const opOnly = [...(mw.match(/const OP_ONLY_PREFIXES = \[([\s\S]*?)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1])
    assert.ok(opOnly.length > 3, 'could not read OP_ONLY_PREFIXES')
    const roots = ep.roots.map((re) => re.replace(/^\^|\$$/g, ''))
    assert.deepEqual(roots.filter((r) => opOnly.some((pfx) => r === pfx || r.startsWith(`${pfx}/`))), [], 'employee tab on an owner-only page')
  })
  stage.test('kiosk-pin-rules', 'קוד צוות לקיוסק מלוח הבקרה: רק 6–8 ספרות שאי אפשר לנחש, ונשמר רק כרשומה של האפליקציה', 'security', async () => {
    const r = m.remote
    for (const bad of ['12345', '123456789', '12a456', '111111', '123456', '654321', '890123', '', '000000']) assert.ok(r.pinProblem(bad), `${bad} refused`)
    for (const good of ['583917', '1029384', '90817263']) assert.equal(r.pinProblem(good), null, `${good} accepted`)
    const rec = r.pinRecord('583917')
    assert.ok(r.PIN_RECORD.test(rec) && !rec.includes('583917'), 'the app\'s record format, without the PIN')
    assert.ok(r.pinMatches(rec, '583917') && !r.pinMatches(rec, '583918'), 'opens with that PIN only')
    assert.ok(r.pinRecord('583917') !== rec, 'a new salt every time')
    assert.ok(!r.remoteActionSchema.safeParse({ action: 'command', slug: 'givat-haviva-1', kind: 'shell' }).success, 'unknown command refused')
    assert.ok(!r.remoteActionSchema.safeParse({ action: 'pin', slug: '../x', pin: '583917', confirm: '583917' }).success, 'bad tablet name refused')
    assert.equal(r.readCommand({ id: 'x', kind: 'reload', at: 'now' })?.kind, 'reload')
    assert.equal(r.readCommand({ id: 'x', kind: 'rm', at: 'now' }), null, 'a stored unknown kind is ignored')
  })
  stage.test('kiosk-stock-rules', 'מלאי מהקיוסק: רק הקטגוריות של המלאי החי, מצב כל סוג (כמות 0 = אזל), ורק פריט מהרשימה ניתן לעדכון', 'unit', async () => {
    const s = m.stock
    const doc = { categories: [
      { id: 'hot', title: { he: 'קפה חם' }, items: [{ uid: 'c1', he: 'הפוך' }] },
      { id: 'p', title: { he: 'מאפים' }, liveOnTablet: true, items: [{ uid: 'p1', he: 'מאפה', types: [{ uid: 't1', he: 'גבינית', quantity: 0 }, { uid: 't2', he: 'שקדים', available: false }, { uid: 't3', he: 'קינמון', quantity: 2 }] }, { he: 'בלי מזהה' }] },
    ] }
    const view = s.stockView(doc)
    assert.deepEqual(view.map((c) => c.name), ['מאפים'], 'only live categories')
    assert.equal(view[0].items.length, 1, 'an item without a uid is left out')
    assert.deepEqual(view[0].items[0].types.map((t) => [t.available, t.quantity]), [[false, 0], [false, null], [true, 2]], 'count 0 and the flag both mean sold out')
    assert.equal(s.stockLabel(doc, 'p1', 't3'), 'מאפה — קינמון')
    assert.equal(s.stockLabel(doc, 'c1', null), null, 'a non-live item cannot be written')
    assert.equal(s.stockLabel(doc, 'p1', 'nope'), null)
    assert.deepEqual(s.stockView(null), [])
    const ok = (b) => s.kioskStockWriteSchema.safeParse(b).success
    assert.ok(ok({ itemUid: 'p1', typeUid: 't1', quantity: 3 }) && ok({ itemUid: 'p1', available: false }))
    assert.ok(!ok({ itemUid: 'p1' }) && !ok({ itemUid: 'p1', quantity: -1 }) && !ok({ itemUid: 'p1', quantity: 1000 }) && !ok({ itemUid: 'a b', available: true }) && !ok({ itemUid: 'p1', available: true, menu: 'x' }), 'bad input refused')
  })
  stage.test('kiosk-install-rules', 'אשף ההתקנה: ה־QR ש־Android קורא (רכיב, הורדה, טביעת התעודה בפורמט הנכון, Wi‑Fi), וקלט לא תקין נדחה', 'unit', async () => {
    const e = m.enroll
    assert.equal(e.certChecksum('00'.repeat(31) + 'ff'), Buffer.from('00'.repeat(31) + 'ff', 'hex').toString('base64url'), 'URL-safe base64, no padding')
    assert.equal(e.certChecksum('nothex'), null)
    const q = JSON.parse(e.provisioningPayload({ apkUrl: 'https://x/a.apk', certSha256: 'ab'.repeat(32), code: 'c'.repeat(43), portal: 'https://x', wifi: { ssid: 'n', security: 'NONE', password: 'ignored' } }))
    assert.equal(q['android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME'], 'il.co.sarcafe.kiosk/.KioskAdminReceiver')
    assert.equal(q['android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED'], true)
    assert.equal(q['android.app.extra.PROVISIONING_WIFI_PASSWORD'], undefined, 'an open network carries no password')
    assert.deepEqual(q['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'], { enroll: 'c'.repeat(43), portal: 'https://x' })
    let threw = false; try { e.provisioningPayload({ apkUrl: 'x', certSha256: 'bad', code: 'c', portal: 'x' }) } catch { threw = true }
    assert.ok(threw, 'a bad certificate digest is refused')
    const ok = (b) => e.installRequestSchema.safeParse(b).success
    const base = { branchId: '123e4567-e89b-42d3-a456-426614174000', slug: 'gh-2', name: 'קיוסק', pin: '583917', confirm: '583917' }
    assert.ok(ok(base) && ok({ ...base, wifi: { ssid: 'a', password: 'b' } }))
    assert.ok(!ok({ ...base, slug: 'A B' }) && !ok({ ...base, extra: 1 }) && !ok({ ...base, wifi: { ssid: 'x'.repeat(33) } }), 'bad input refused')
    assert.ok(e.enrollRequestSchema.safeParse({ code: 'a'.repeat(43) }).success && !e.enrollRequestSchema.safeParse({ code: 'a'.repeat(42) }).success)
  })
  stage.test('kiosk-menu-edit-rules', 'עורך התפריט בקיוסק: עץ התפריט, מציאת פריט/סוג, ומה מותר לשלוח (שם, מחיר, פעולות)', 'unit', async () => {
    const e = m.menuEdit
    const doc = { categories: [{ id: 'p', title: { he: 'מאפים' }, items: [{ uid: 'a', he: 'מאפה', price: 12, types: [{ uid: 't', he: 'גבינית', priceDelta: 2 }] }, { he: 'בלי מזהה' }] }] }
    const tree = e.menuTree(doc)
    assert.deepEqual(tree[0].items.map((i) => [i.name, i.price, i.types.length]), [['מאפה', '12', 1]], 'items without an id are left out; prices as text')
    assert.deepEqual(e.findEntry(doc, 'a', 't'), { label: 'מאפה — גבינית', hasTypes: true })
    assert.equal(e.findEntry(doc, 'nope'), null)
    assert.equal(e.itemOfType(doc, 't'), 'a')
    const ok = (b) => e.menuEditSchema.safeParse(b).success
    assert.ok(ok({ op: 'update', itemUid: 'a', price: '14.5' }) && ok({ op: 'update', itemUid: 'a', price: '20/24' }) && ok({ op: 'add_item', categoryId: 'p', name: 'x' }))
    assert.ok(!ok({ op: 'update', itemUid: 'a', price: '-1' }) && !ok({ op: 'update', itemUid: 'a', price: '₪14' }) && !ok({ op: 'add_item', categoryId: 'p', name: '   ' }) && !ok({ op: 'nuke' }), 'bad input refused')
    assert.ok(e.isEmptyEdit(e.menuEditSchema.parse({ op: 'update', itemUid: 'a' })) && !e.isEmptyEdit(e.menuEditSchema.parse({ op: 'update', itemUid: 'a', name: 'b' })))
  })
  stage.test('qa-digest', 'הודעת 07:00: הודעה אחת, שני דוחות, עבר/נכשל, וקישור לבעיות כשמשהו נכשל; דוח שלא הגיע = כישלון', 'unit', async () => {
    const d = m.digest
    const pass = { id: 'a', status: 'pass', passed: 100, tests: 101, failed: 0, skipped: 1 }
    const fail = { id: 'b', status: 'fail', passed: 40, tests: 43, failed: 3, skipped: 0 }
    const ok = d.composeDigest({ dashboard: pass, kiosk: { ...pass, id: 'c' } })
    assert.equal(ok.status, 'pass'); assert.equal(ok.kind, 'dev.qa_digest_pass'); assert.equal(ok.url, '/staff/dev/qa')
    assert.ok(ok.body.includes('לוח הבקרה: עבר 100/100') && ok.body.includes('הקיוסק: עבר'), ok.body)
    const k = d.composeDigest({ dashboard: pass, kiosk: fail })
    assert.equal(k.status, 'fail'); assert.equal(k.kind, 'dev.qa_digest_fail')
    assert.equal(k.url, '/staff/dev/qa?suite=kiosk&focus=problems', 'opens the failing suite at its problems')
    assert.ok(k.title.includes('הקיוסק נכשל') && k.body.includes('3 בדיקות'), `${k.title} / ${k.body}`)
    const missing = d.composeDigest({ dashboard: null, kiosk: pass })
    assert.equal(missing.status, 'fail', 'a report that did not arrive is a failure')
    assert.ok(missing.body.includes('הדוח לא הגיע'))
    assert.ok(/^\/(?!\/)[A-Za-z0-9/_\-?=&%.]*$/.test(k.url), 'the link survives the push link filter (no #)')
    assert.equal(d.israelDay(new Date('2026-11-05T23:30:00Z')), '2026-11-06', 'the day is Israel\'s')
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
  stage.test('expected-actual', 'הדוח: כל בדיקה כותבת מה היה צפוי ומה קרה בפועל; כישלון מוצג קודם, גם שגיאה שאינה בדיקה; והדוח עומד בחוזה', 'unit', async () => {
    const inner = createStage('demo', 'demo')
    inner.test('ok', 'עוברת', 'unit', async () => { assert.status({ status: 401 }, 401, 'בלי חיבור'); assert.equal(3, 3, 'כמות') })
    inner.test('bad', 'נכשלת', 'unit', async () => { assert.equal('a', 'a', 'שם'); assert.equal(2, 5, 'כמות') }, { retry: false })
    inner.test('crash', 'קורסת', 'unit', async () => { throw new Error('boom') }, { retry: false })
    const r = await inner.run({ log: () => {} })
    startChecks() // the demo stage used the same recorder; this test's own checks start here
    const [ok, bad, crash] = r.tests
    assert.deepEqual(ok.checks.map((c) => [c.what, c.expected, c.actual, c.ok]), [['בלי חיבור', 'HTTP 401', 'HTTP 401', true], ['כמות', '3', '3', true]], 'a passing test keeps its checks')
    assert.deepEqual([bad.checks[0].what, bad.checks[0].expected, bad.checks[0].actual, bad.checks[0].ok], ['כמות', '5', '2', false], 'the failing check comes first')
    assert.equal(crash.checks[0].actual, 'boom', 'an error that is not a check is shown as one')
    const report = buildReport({ suite: 'dashboard', stages: [r], startedAt: new Date().toISOString(), source: 'local', commit: null, ref: null, host: 'local', metrics: {}, previous: null })
    const parsed = m.report.QaReport.safeParse(report)
    assert.ok(parsed.success, `the report with checks fits the contract ${parsed.success ? '' : JSON.stringify(parsed.error.issues[0])}`)
  })
  stage.test('report-contract', 'חוזה הדוח: הדוח שנשלח עם הקוד תקין, ושדה לא מוכר נדחה', 'unit', async () => {
    const shipped = JSON.parse(fs.readFileSync(path.join(root, 'qa/reports/latest.json'), 'utf8'))
    const ok = m.report.QaReport.safeParse(shipped)
    assert.ok(ok.success, ok.success ? '' : JSON.stringify(ok.error.issues.slice(0, 3)))
    assert.ok(!m.report.QaReport.safeParse({ ...shipped, extra: 1 }).success, 'unknown key accepted')
    const huge = structuredClone(shipped); huge.review.headline = 'x'.repeat(5000)
    assert.ok(!m.report.QaReport.safeParse(huge).success, 'oversize accepted')
  })
  // ── hybrid identity foundation (FABLE-001, docs/SARCAFE_IDENTITY.md). The same decision is run against the real SQL function,
  // with two businesses and two organizations, by scripts/verify-identity-sql.mjs (the 'checks' stage).
  const ID = { b1: '11111111-1111-4111-8111-111111111111', b2: '22222222-2222-4222-8222-222222222222', orgA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', orgB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', dept: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', user: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', staff: 'ffffffff-ffff-4fff-8fff-ffffffffffff', grant: '99999999-9999-4999-8999-999999999999', principal: '88888888-8888-4888-8888-888888888888' }
  stage.test('identity-scope', 'זהויות: כל פעולה נקשרת לעסק אחד, לארגון אחד או למחלקה אחת בדיוק; היקף רחב, כפול או חסר נדחה', 'security', async () => {
    const i = m.identity
    assert.deepEqual(i.normalizeScope({ kind: 'business', businessId: ID.b1 }), { kind: 'business', businessId: ID.b1 }, 'a business')
    assert.deepEqual(i.normalizeScope({ kind: 'organization', organizationId: ID.orgA }), { kind: 'organization', organizationId: ID.orgA }, 'an organization')
    assert.deepEqual(i.normalizeScope({ kind: 'department', organizationId: ID.orgA, departmentId: ID.dept }), { kind: 'department', organizationId: ID.orgA, departmentId: ID.dept }, 'a department with its organization')
    assert.deepEqual(i.normalizeScope({ kind: 'business', businessId: ID.b1, organizationId: undefined }), { kind: 'business', businessId: ID.b1 }, 'an undefined extra field is nothing')
    const refused = [undefined, null, 'business', [], {}, { kind: 'all' }, { kind: 'global' }, { businessId: ID.b1 }, { kind: 'business' }, { kind: 'business', businessId: 'sarcafe' }, { kind: 'organization', organizationId: ID.orgA.toUpperCase() },
      { kind: 'business', businessId: ID.b1, organizationId: ID.orgA }, { kind: 'organization', organizationId: ID.orgA, businessId: ID.b1 }, { kind: 'organization', organizationId: ID.orgA, departmentId: ID.dept },
      { kind: 'department', departmentId: ID.dept }, { kind: 'department', organizationId: ID.orgA }, { kind: 'department', organizationId: ID.orgA, departmentId: ID.dept, businessId: ID.b1 }, { kind: 'business', businessId: [ID.b1] }, { kind: 'business', businessId: ID.b1, role: 'owner' }]
    assert.deepEqual(refused.filter((x) => i.normalizeScope(x) !== null).map((x) => JSON.stringify(x)), [], 'scopes that should have been refused:')
    assert.deepEqual(i.IDENTITY_CAPABILITIES.map((c) => [c, i.SCOPE_OF[c]]), [['business_admin', 'business'], ['organization_admin', 'organization'], ['department_head', 'department']], 'each capability has one scope shape')
    assert.ok(i.capabilityFitsScope('business_admin', { kind: 'business', businessId: ID.b1 }) && !i.capabilityFitsScope('business_admin', { kind: 'organization', organizationId: ID.orgA }) && !i.capabilityFitsScope('organization_admin', { kind: 'department', organizationId: ID.orgA, departmentId: ID.dept }), 'a capability only fits its own scope')
    assert.deepEqual(i.accessCheckArgs(ID.user, 'department_head', { kind: 'department', organizationId: ID.orgA, departmentId: ID.dept }), { authUserId: ID.user, capability: 'department_head', businessId: null, organizationId: ID.orgA, departmentId: ID.dept }, 'the question sent to the database')
    assert.ok(!i.isCapability('owner') && !i.isCapability('benefit_scanner') && !i.isCapability(null) && i.isCapability('business_admin'), 'unknown capabilities')
  })
  stage.test('identity-guard', 'זהויות: מי רשאי לנהל — רק התחברות מלאה, רק בהיקף שלו; בעלים של סרקפה לא מקבל עסק אחר, הרשאה שבוטלה לא עובדת, ותקלה אינה גישה', 'security', async () => {
    const i = m.identity
    const owner = { id: ID.staff, role: 'owner', badge: 'owner', branch_id: null }
    const full = (staff = null, over = {}) => ({ authUserId: ID.user, via: 'google', full: true, staff, ...over })
    const business = (id) => ({ kind: 'business', businessId: id })
    // a stand-in for the database: Sarcafe (b1) is the legacy business, a grant exists for organization A only
    let asked = []
    const db = (grants = {}) => async (args) => {
      asked.push(args)
      if (args.capability === 'business_admin' && args.businessId === ID.b1 && grants.legacyOwner) return { ok: true, via: 'legacy_owner', staff_id: ID.staff }
      if (args.capability === 'organization_admin' && args.organizationId === ID.orgA && grants.orgA) return { ok: true, via: 'grant', grant_id: ID.grant, principal_id: ID.principal }
      return { ok: false, error: 'denied' }
    }
    const decide = (session, capability, scope, check) => { asked = []; return i.authorizeIdentityAction(session, { capability, scope }, check) }
    const code = (o) => (o.ok ? 'ok:' + o.via : o.status + ':' + o.code)
    const table = [
      ['signed out', null, 'business_admin', business(ID.b1), db({ legacyOwner: true }), '401:unauthenticated', 0],
      ['an owner on an employee-code session', { authUserId: null, via: 'employee_code', full: false, staff: owner }, 'business_admin', business(ID.b1), db({ legacyOwner: true }), '403:full_session_required', 0],
      ['an owner on a quick Google session', full(owner, { full: false }), 'business_admin', business(ID.b1), db({ legacyOwner: true }), '403:quick_session', 0],
      ['an owner, full session, Sarcafe', full(owner), 'business_admin', business(ID.b1), db({ legacyOwner: true }), 'ok:legacy_owner', 1],
      ['an owner by badge only', full({ id: ID.staff, role: 'staff', badge: 'owner' }), 'business_admin', business(ID.b1), db({ legacyOwner: true }), 'ok:legacy_owner', 1],
      ['WRONG BUSINESS: the same owner, another business', full(owner), 'business_admin', business(ID.b2), db({ legacyOwner: true }), '403:denied', 1],
      ['an owner asking for an organization', full(owner), 'organization_admin', { kind: 'organization', organizationId: ID.orgA }, db({ legacyOwner: true }), '403:denied', 1],
      ['a general manager', full({ id: ID.staff, role: 'staff', badge: 'general_manager' }), 'business_admin', business(ID.b1), db({}), '403:denied', 1],
      ['an employee', full({ id: ID.staff, role: 'staff', badge: 'barista' }), 'business_admin', business(ID.b1), db({}), '403:denied', 1],
      ['the database says legacy owner, the session has no owner row', full({ id: ID.staff, role: 'staff', badge: 'barista' }), 'business_admin', business(ID.b1), db({ legacyOwner: true }), '403:denied', 1],
      ['an external administrator with a grant', full(null), 'organization_admin', { kind: 'organization', organizationId: ID.orgA }, db({ orgA: true }), 'ok:grant', 1],
      ['the same administrator after the grant was REVOKED', full(null), 'organization_admin', { kind: 'organization', organizationId: ID.orgA }, db({}), '403:denied', 1],
      ['WRONG ORGANIZATION', full(null), 'organization_admin', { kind: 'organization', organizationId: ID.orgB }, db({ orgA: true }), '403:denied', 1],
      ['an external administrator asking for a business', full(null), 'business_admin', business(ID.b1), db({ orgA: true }), '403:denied', 1],
      ['a capability in the wrong scope', full(owner), 'organization_admin', business(ID.b1), db({ legacyOwner: true }), '400:bad_scope', 0],
      ['no scope', full(owner), 'business_admin', undefined, db({ legacyOwner: true }), '400:bad_scope', 0],
      ['a scope with an extra tenant', full(owner), 'business_admin', { kind: 'business', businessId: ID.b1, organizationId: ID.orgA }, db({ legacyOwner: true }), '400:bad_scope', 0],
      ['an unknown capability', full(owner), 'owner', business(ID.b1), db({ legacyOwner: true }), '400:bad_scope', 0],
      ['the database does not answer', full(owner), 'business_admin', business(ID.b1), async () => { throw new Error('down') }, '503:unavailable', 0],
      ['the database answers nonsense', full(owner), 'business_admin', business(ID.b1), async () => ({ ok: true, via: 'superuser' }), '403:denied', 0],
      ['a grant answer without its ids', full(null), 'organization_admin', { kind: 'organization', organizationId: ID.orgA }, async () => ({ ok: true, via: 'grant' }), '403:denied', 0],
      ['a legacy-owner answer for an organization', full(owner), 'organization_admin', { kind: 'organization', organizationId: ID.orgA }, async () => ({ ok: true, via: 'legacy_owner', staff_id: ID.staff }), '403:denied', 0],
    ]
    for (const [label, session, capability, scope, check, expected, questions] of table) {
      const outcome = await decide(session, capability, scope, check)
      assert.equal(code(outcome), expected, label)
      assert.equal(asked.length, questions, label + ': questions put to the database')
    }
    const ok = await decide(full(owner), 'business_admin', business(ID.b1), db({ legacyOwner: true }))
    assert.deepEqual(asked[0], { authUserId: ID.user, capability: 'business_admin', businessId: ID.b1, organizationId: null, departmentId: null }, 'the database is asked about the session\'s own user and exactly that scope')
    assert.deepEqual([ok.staffId, ok.grantId, ok.principalId, ok.scope], [ID.staff, null, null, business(ID.b1)], 'what a passing answer carries')
  })
  // Nothing uses the identity module yet: it must not have changed who gets into the existing app.
  stage.test('identity-isolated', 'זהויות: היסוד החדש לא נוגע בכניסה, בבעלים, בצוות, בקופה, בקיוסק או ברשימת ההמתנה, ואין לו מסך או נתיב', 'security', async () => {
    const src = path.join(root, 'src')
    const files = []
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p) } }
    walk(src)
    const rel = (f) => path.relative(root, f).split(path.sep).join('/')
    const inside = (f) => rel(f).startsWith('src/lib/identity/')
    const users = files.filter((f) => !inside(f) && /['"]@\/lib\/identity\//.test(fs.readFileSync(f, 'utf8'))).map(rel)
    assert.deepEqual(users, [], 'files outside src/lib/identity that import it (this slice has no route and no screen):')
    const reach = files.filter((f) => !inside(f) && /customer_(members|principals|businesses|business_branches|organizations|departments|business_orgs|access_grants|org_memberships|business_memberships|identity_audit|access_check|access_grant|access_revoke)\b/.test(fs.readFileSync(f, 'utf8'))).map(rel)
    assert.deepEqual(reach, [], 'files outside src/lib/identity that touch the identity tables or functions:')
    const server = files.filter((f) => rel(f).startsWith('src/lib/identity/server/'))
    assert.ok(server.length >= 3, 'the server part exists')
    assert.deepEqual(server.filter((f) => !/^import 'server-only'/.test(fs.readFileSync(f, 'utf8'))).map(rel), [], 'server files that do not start with server-only:')
    const pure = files.filter((f) => inside(f) && !rel(f).startsWith('src/lib/identity/server/'))
    assert.deepEqual(pure.filter((f) => /server-only|node:|supabase|next\/|process\.env/.test(fs.readFileSync(f, 'utf8'))).map(rel), [], 'pure rule files that reach a server, a secret or the database:')
    const writes = files.filter(inside).filter((f) => /\.from\(['"](staff|staff_\w+|auth\.\w+|customer_waitlist\w*|pos_\w+)['"]\)|auth\.admin|createUser|signUp/.test(fs.readFileSync(f, 'utf8'))).map(rel)
    assert.deepEqual(writes, [], 'identity files that reach staff, auth accounts, POS or the waitlist:')
  })

  return stage
}
