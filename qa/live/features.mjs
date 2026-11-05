// Stage — the new features end to end over HTTP: the team message backend (who may send, who receives, push-enabled only, validation,
// limits, duplicates, leaks) and the tool finder's history that follows a person across devices.
import { randomUUID } from 'node:crypto'
import { createStage, assert } from '../lib/harness.mjs'
import { ID } from '../standin/seed.mjs'
import { signToken } from '../standin/supabase.mjs'
import { OIDC_ISSUER } from './app.mjs'
import fs from 'node:fs'

const STAFF_IDS = Object.entries(ID).filter(([k]) => !/^(gh|maor|week|shift)/.test(k)).map(([, v]) => v)
const noLeak = (text) => { assert.ok(!STAFF_IDS.some((id) => text.includes(id)), 'a staff id leaked'); assert.notMatch(text, /@qa\.sarcafe|p256dh|fcm\.googleapis|endpoint/i, 'private data leaked') }

export function featuresStage(live) {
  const stage = createStage('features', 'התכונות החדשות: הודעה לצוות והיסטוריית החיפוש')
  const send = (as, body) => live().call('/api/owner/team-message', { method: 'POST', as, origin: true, body: { requestId: randomUUID(), ...body } })
  const messages = () => live().db('schedule_notifications').filter((n) => n.kind === 'staff.message')
  const plan = async (as = 'owner', branch = 'givat-haviva') => (await live().call(`/api/owner/team-message?branch=${branch}`, { as })).json
  // each test starts with an empty limiter, so one test's sends never turn the next test's checks into 429s
  const fresh = () => live().standin.state.limits.clear()

  stage.test('reset', 'מתחילים ממצב נקי של מסד הנתונים המדומה', 'e2e', async () => { live().reset() }, { retry: false })

  // ── team message: what the composer is shown
  stage.test('tm-plan', 'מסך ההודעה מקבל את הצוות, מי הפעיל התראות והמשמרות המפורסמות בלבד', 'e2e', async () => {
    const res = await live().call('/api/owner/team-message?branch=givat-haviva', { as: 'owner' })
    assert.status(res, 200)
    const p = res.json
    assert.equal(p.days.length, 7, 'days')
    assert.deepEqual(p.team, { total: 5, reachable: 4 }, 'team (sender, inactive and other-branch staff excluded):')
    const today = p.days[0].shifts.map((s) => `${s.start}-${s.end}:${s.people.map((x) => `${x.name}${x.reachable ? '' : '(off)'}`).join(',')}`)
    assert.deepEqual(today, ['00:00-23:59:איתי(off),דנה', '14:00-22:00:דנה'], 'today (names in Hebrew order):')
    const tomorrow = p.days[1].shifts[0].people.map((x) => x.name).sort()
    assert.deepEqual(tomorrow, ['איתי', 'גלית', 'דנה'], 'tomorrow (inactive Roi left out):')
    assert.equal(p.days[2].shifts.length, 0, 'the draft week is never offered')
    noLeak(res.text)
  })

  // ── who receives it
  stage.test('tm-all', '"כל הצוות": נשלח רק למי שהפעיל התראות, השולח לא מקבל, לא פעילים ועובדי סניף אחר לא מקבלים', 'e2e', async () => { fresh();
    const res = await send('owner', { branch: 'givat-haviva', audience: 'all', text: 'בדיקה לכולם' })
    assert.status(res, 200)
    assert.equal(res.json.sent, 4); assert.equal(res.json.skipped, 1)
    const to = messages().map((n) => n.staff_id).sort()
    assert.deepEqual(to, [ID.dev, ID.gm, ID.dana, ID.shira].sort(), 'recipients:')
    const row = messages()[0]
    assert.equal(row.title, 'הודעה מאורית'); assert.equal(row.body, 'בדיקה לכולם'); assert.equal(row.link.url, '/staff')
    noLeak(res.text)
  })
  stage.test('tm-shift', 'משמרת מסוימת: נשלח למשובצים שהפעילו התראות בלבד', 'e2e', async () => { fresh();
    const before = messages().length
    const res = await send('owner', { branch: 'givat-haviva', audience: 'shift', shiftId: ID.shiftTomorrowAm, text: 'מגיע משלוח חלב בבוקר' })
    assert.status(res, 200)
    assert.equal(res.json.sent, 2); assert.equal(res.json.skipped, 1)
    assert.deepEqual(messages().slice(before).map((n) => n.staff_id).sort(), [ID.gm, ID.dana].sort())
  })
  stage.test('tm-one', 'עובד/ת אחד/ת במשמרת: רק אליו/ה', 'e2e', async () => { fresh();
    const p = await plan()
    const dana = p.days[1].shifts[0].people.find((x) => x.name === 'דנה')
    const before = messages().length
    const res = await send('owner', { branch: 'givat-haviva', audience: 'shift', shiftId: ID.shiftTomorrowAm, assignmentId: dana.key, text: 'רק לך' })
    assert.status(res, 200)
    assert.deepEqual(messages().slice(before).map((n) => n.staff_id), [ID.dana])
    assert.equal(messages().at(-1).link.audience, 'one')
  })
  stage.test('tm-one-off', 'מי שלא הפעיל/ה התראות לא מקבל/ת, וההודעה לא נשלחת', 'e2e', async () => { fresh();
    const p = await plan()
    const itai = p.days[1].shifts[0].people.find((x) => x.name === 'איתי')
    const before = messages().length
    const res = await send('owner', { branch: 'givat-haviva', audience: 'shift', shiftId: ID.shiftTomorrowAm, assignmentId: itai.key, text: 'שלום' })
    assert.status(res, 409); assert.equal(res.json.error.code, 'no_recipients')
    assert.equal(messages().length, before)
  })
  stage.test('tm-duplicate', 'אותה בקשה פעמיים (לחיצה כפולה, ניסיון חוזר) נשלחת פעם אחת', 'e2e', async () => { fresh();
    const requestId = randomUUID()
    const body = { requestId, branch: 'givat-haviva', audience: 'shift', shiftId: ID.shiftTodayPm, text: 'פעם אחת' }
    assert.status(await live().call('/api/owner/team-message', { method: 'POST', as: 'owner', origin: true, body }), 200)
    const after = messages().length
    const again = await live().call('/api/owner/team-message', { method: 'POST', as: 'owner', origin: true, body })
    assert.status(again, 409); assert.equal(again.json.error.code, 'duplicate')
    assert.equal(messages().length, after)
    const audit = live().db('staff_messages').find((m) => m.id === requestId)
    assert.ok(audit && audit.status === 'sent' && audit.recipients === 1, 'audit row')
  })

  // ── who may send
  stage.test('tm-gm', 'מנהל/ת סניף: שולח/ת בסניף שלו/ה בלבד, ולא מקבל/ת את ההודעה של עצמו/ה', 'security', async () => { fresh();
    const before = messages().length
    const res = await send('gm', { branch: 'givat-haviva', audience: 'shift', shiftId: ID.shiftTomorrowAm, text: 'מהמנהלת' })
    assert.status(res, 200)
    assert.deepEqual(messages().slice(before).map((n) => n.staff_id), [ID.dana])
    assert.status(await send('gm', { branch: 'maor', audience: 'all', text: 'x' }), 403)
    assert.status(await send('gm', { branch: 'givat-haviva', audience: 'shift', shiftId: ID.shiftMaorTomorrow, text: 'x' }), 404, 'another branch\'s shift')
  })
  stage.test('tm-roles', 'עובד/ת ומי שלא מחובר לא יכולים לשלוח', 'security', async () => { fresh();
    assert.status(await send('dana', { branch: 'givat-haviva', audience: 'all', text: 'x' }), 403)
    assert.status(await send(null, { branch: 'givat-haviva', audience: 'all', text: 'x' }), 401)
    // Who is asking is decided before anything is looked up: a real branch and a made-up one get the same answer (no probing of names).
    for (const [who, status] of [[null, 401], ['dana', 403]]) {
      for (const branch of ['givat-haviva', 'no-such-branch']) {
        const read = await live().call(`/api/owner/team-message?branch=${branch}`, { as: who ?? undefined })
        assert.status(read, status, `${who ?? 'signed out'} reading ${branch}`)
        assert.status(await send(who, { branch, audience: 'all', text: 'x' }), status, `${who ?? 'signed out'} sending to ${branch}`)
      }
    }
  })
  stage.test('tm-shifts', 'משמרת לא מפורסמת, ישנה, רחוקה, של סניף אחר או מומצאת: נדחית באותה תשובה', 'security', async () => { fresh();
    for (const shiftId of [ID.shiftDraft, ID.shiftOld, ID.shiftFar, ID.shiftMaorTomorrow, randomUUID()]) {
      const res = await send('owner', { branch: 'givat-haviva', audience: 'shift', shiftId, text: 'x' })
      assert.status(res, 404, shiftId)
    }
    const other = await send('owner', { branch: 'givat-haviva', audience: 'shift', shiftId: ID.shiftTodayPm, assignmentId: randomUUID(), text: 'x' })
    assert.status(other, 404, 'assignment not on that shift')
  })
  stage.test('tm-validation', 'בקשה לא תקינה נדחית (400) לפני שנוגעים במשהו', 'security', async () => { fresh();
    const bad = [
      { branch: 'givat-haviva', audience: 'all', shiftId: ID.shiftTodayPm, text: 'x' },
      { branch: 'givat-haviva', audience: 'shift', text: 'x' },
      { branch: 'givat-haviva', audience: 'all', text: 'x', admin: true },
      { branch: 'givat-haviva', audience: 'all', text: '   ' },
      { branch: 'givat-haviva', audience: 'all', text: 'x'.repeat(281) },
      { branch: 'givat-haviva', audience: 'everyone', text: 'x' },
    ]
    for (const body of bad) assert.status(await send('owner', body), 400, JSON.stringify(body).slice(0, 80))
    assert.status(await live().call('/api/owner/team-message', { method: 'POST', as: 'owner', origin: true, body: { requestId: 'not-a-uuid', branch: 'givat-haviva', audience: 'all', text: 'x' } }), 400)
    assert.status(await send('owner', { branch: '../etc', audience: 'all', text: 'x' }), 404)
  })
  stage.test('tm-clean', 'תווים מוסתרים וזיוף כיוון מנוקים לפני השמירה', 'security', async () => { fresh();
    const res = await send('owner', { branch: 'givat-haviva', audience: 'shift', shiftId: ID.shiftTodayPm, text: 'שלום‮​ עולם\n' })
    assert.status(res, 200)
    assert.equal(messages().at(-1).body, 'שלום עולם')
  })
  stage.test('tm-limit', 'הגבלת קצב: 6 הודעות ב־10 דקות לשולח, השביעית נדחית (429)', 'security', async () => { fresh();
    const statuses = []
    for (let i = 0; i < 7; i++) statuses.push((await send('dev', { branch: 'givat-haviva', audience: 'shift', shiftId: ID.shiftTodayPm, text: `הודעה ${i}` })).status)
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 429])
  })
  stage.test('tm-limiter-down', 'כשמגביל הקצב לא עונה ההודעה לא יוצאת (נכשל סגור)', 'survival', async () => { fresh();
    await live().control('/__qa/missing', { functions: ['check_rate_limit'] })
    try {
      const before = messages().length
      const res = await send('owner', { branch: 'givat-haviva', audience: 'all', text: 'x' })
      assert.status(res, 503)
      assert.equal(messages().length, before)
    } finally { await live().control('/__qa/missing', {}) }
  })
  stage.test('tm-no-migration', 'לפני המיגרציה: ההודעה נשלחת, ולחיצה כפולה עדיין לא שולחת פעמיים', 'recovery', async () => { fresh();
    await live().control('/__qa/missing', { tables: ['staff_messages'] })
    try {
      const requestId = randomUUID()
      const body = { requestId, branch: 'givat-haviva', audience: 'shift', shiftId: ID.shiftTodayPm, text: 'בלי מיגרציה' }
      assert.status(await live().call('/api/owner/team-message', { method: 'POST', as: 'owner', origin: true, body }), 200)
      assert.status(await live().call('/api/owner/team-message', { method: 'POST', as: 'owner', origin: true, body }), 409)
    } finally { await live().control('/__qa/missing', {}) }
  })
  stage.test('tm-inbox', 'מי שקיבל/ה רואה את ההודעה בהתראות, והקישור מוביל לבית', 'e2e', async () => { fresh();
    const res = await live().call('/api/staff/notifications', { as: 'dana' })
    assert.status(res, 200)
    const msg = res.json.notifications.find((n) => n.kind === 'staff.message')
    assert.ok(msg, 'no message in the inbox')
    assert.equal(msg.link.url, '/staff')
    const itai = await live().call('/api/staff/notifications', { as: 'itai' })
    assert.ok(!itai.json.notifications.some((n) => n.kind === 'staff.message'), 'someone without notifications got it')
  })

  // ── the tool finder's history
  stage.test('tu-before', 'לפני המיגרציה: ההיסטוריה עונה "לא מסונכרן" והאתר ממשיך לעבוד', 'recovery', async () => {
    await live().control('/__qa/missing', { tables: ['staff_tool_usage', 'staff_tool_searches'], functions: ['staff_tool_usage_record'] })
    try {
      const get = await live().call('/api/staff/tool-usage', { as: 'owner' })
      assert.status(get, 200); assert.equal(get.json.synced, false)
      const post = await live().call('/api/staff/tool-usage', { method: 'POST', as: 'owner', origin: true, body: { op: 'use', id: 'schedule-manage' } })
      assert.status(post, 200); assert.equal(post.json.synced, false)
    } finally { await live().control('/__qa/missing', {}) }
  })
  stage.test('tu-follow', 'ההיסטוריה עוקבת אחרי האדם: נשמרת, נקראת מכל מכשיר, וכוללת את החיפוש', 'e2e', async () => {
    const use = await live().call('/api/staff/tool-usage', { method: 'POST', as: 'owner', origin: true, body: { op: 'use', id: 'schedule-manage', q: 'סידור' } })
    assert.status(use, 200); assert.equal(use.json.synced, true)
    const get = (await live().call('/api/staff/tool-usage', { as: 'owner' })).json
    assert.equal(get.usage['schedule-manage'].n, 1); assert.deepEqual(get.queries, ['סידור'])
    const other = (await live().call('/api/staff/tool-usage', { as: 'dana' })).json
    assert.deepEqual(other.usage, {}, 'another person sees it')
  })
  stage.test('tu-merge', 'מכשיר ישן מצטרף פעם אחת: המספר הגבוה נשמר, איחוד כפול לא מכפיל', 'e2e', async () => {
    const usage = { 'staff-list': { n: 5, t: Date.now() - 1000 } }
    for (let i = 0; i < 2; i++) assert.status(await live().call('/api/staff/tool-usage', { method: 'POST', as: 'owner', origin: true, body: { op: 'merge', usage } }), 200)
    assert.equal((await live().call('/api/staff/tool-usage', { as: 'owner' })).json.usage['staff-list'].n, 5)
  })
  stage.test('tu-validate', 'היסטוריה: כלי לא קיים, מזהה זדוני, יותר מ־60 כלים או שדה לא צפוי נדחים', 'security', async () => {
    const post = (body) => live().call('/api/staff/tool-usage', { method: 'POST', as: 'owner', origin: true, body })
    assert.status(await post({ op: 'use', id: 'not-a-tool' }), 400)
    assert.status(await post({ op: 'use', id: "x'); drop table staff;--" }), 400)
    assert.status(await post({ op: 'use', id: 'profile', extra: 1 }), 400)
    const many = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`tool-${i}`, { n: 1, t: 1 }]))
    assert.status(await post({ op: 'merge', usage: many }), 400)
    assert.status(await live().call('/api/staff/tool-usage', { method: 'POST', origin: true, body: { op: 'reset' } }), 401)
  })
  stage.test('tu-reset', 'איפוס מוחק את ההיסטוריה בכל המכשירים', 'e2e', async () => {
    assert.status(await live().call('/api/staff/tool-usage', { method: 'POST', as: 'owner', origin: true, body: { op: 'reset' } }), 200)
    const get = (await live().call('/api/staff/tool-usage', { as: 'owner' })).json
    assert.deepEqual(get.usage, {}); assert.deepEqual(get.queries, [])
  })

  // ── the QA reports and the 07:00 digest (owner, 2026-11-05): GitHub posts with its own short-lived token (OIDC, lib/qa/auth.ts) —
  // only THIS repository's QA workflow on main, for our audience, unexpired, signed by the issuer's key (the stand-in plays GitHub)
  const now = () => Math.floor(Date.now() / 1000)
  const claims = (over = {}) => ({ iss: OIDC_ISSUER, aud: 'sarcafe-qa', repository: 'unixecho/Sarcafe-Portal', ref: 'refs/heads/main', workflow_ref: 'unixecho/Sarcafe-Portal/.github/workflows/qa.yml@refs/heads/main', iat: now(), nbf: now() - 5, exp: now() + 300, ...over })
  const shipped = () => JSON.parse(fs.readFileSync(new URL('../reports/latest.json', import.meta.url), 'utf8'))
  const post = (path, token, body) => live().call(path, { method: 'POST', body: body ?? {}, headers: token ? { authorization: `Bearer ${token}` } : {} })

  stage.test('qa-auth', 'דוח QA מתקבל רק מ־GitHub של הפרויקט הזה (OIDC) או עם הסוד; אסימון מזויף, של מאגר אחר, ענף אחר, זרימה אחרת או שפג — נדחה', 'security', async () => {
    const report = { ...shipped(), suite: 'dashboard' }
    assert.status(await post('/api/qa/report', null, report), 401, 'nothing')
    assert.status(await post('/api/qa/report', 'not-the-secret', report), 401, 'a wrong secret')
    for (const [why, token] of [
      ['forged (another key)', signToken(claims(), { forge: true })],
      ['another repository', signToken(claims({ repository: 'someone/else' }))],
      ['another branch', signToken(claims({ ref: 'refs/heads/feature' }))],
      ['another workflow', signToken(claims({ workflow_ref: 'unixecho/Sarcafe-Portal/.github/workflows/other.yml@refs/heads/main' }))],
      ['another audience', signToken(claims({ aud: 'sts.amazonaws.com' }))],
      ['expired', signToken(claims({ exp: now() - 120 }))],
      ['another issuer', signToken(claims({ iss: 'https://evil.example' }))],
    ]) assert.status(await post('/api/qa/report', token, report), 401, why)
    assert.status(await post('/api/qa/report', signToken(claims()), report), 201, 'GitHub\'s token')
    assert.status(await post('/api/qa/report', signToken(claims()), { ...report, suite: 'kiosk' }), 201, 'the kiosk\'s report')
    const runs = live().db('qa_runs')
    assert.ok(runs.some((r) => r.suite === 'dashboard') && runs.some((r) => r.suite === 'kiosk'), 'both suites stored, each with its name')
    assert.status(await post('/api/qa/report', signToken(claims()), { ...report, suite: 'other' }), 400, 'an unknown suite')
  })

  stage.test('qa-digest', 'הודעת 07:00: אחת ביום, רק למפתח, עם שני הדוחות; כשמשהו נכשל — קישור לבעיות; דוח שלא הגיע = כישלון', 'e2e', async () => {
    const token = signToken(claims())
    assert.status(await post('/api/qa/digest', null), 401, 'nothing')
    live().db('qa_digests').length = 0
    const runs = live().db('qa_runs')
    runs.length = 0
    const base = { created_at: new Date().toISOString(), source: 'schedule', commit_sha: null, ref: 'main', review: {}, report: {} }
    runs.push({ ...base, id: randomUUID(), suite: 'dashboard', status: 'pass', totals: { tests: 120, passed: 119, failed: 0, flaky: 0, skipped: 1 } })
    runs.push({ ...base, id: randomUUID(), suite: 'kiosk', status: 'fail', totals: { tests: 40, passed: 37, failed: 3, flaky: 0, skipped: 0 } })
    const dry = await post('/api/qa/digest?dry=1', token)
    assert.status(dry, 200)
    assert.equal(dry.json.digest.status, 'fail')
    assert.equal(dry.json.digest.url, '/staff/dev/qa?suite=kiosk&focus=problems')
    assert.equal(live().db('qa_digests').length, 0, 'a dry run sends and records nothing')
    const before = live().db('schedule_notifications').length
    const sent = await post('/api/qa/digest', token)
    assert.status(sent, 201)
    const rows = live().db('schedule_notifications').slice(before)
    assert.ok(rows.length >= 1 && rows.every((r) => r.staff_id === ID.dev), `only the developer (${rows.map((r) => r.staff_id)})`)
    assert.equal(rows[0].kind, 'dev.qa_digest_fail')
    assert.ok(rows[0].body.includes('לוח הבקרה: עבר 119/119') && rows[0].body.includes('הקיוסק: נכשל, 3 בדיקות'), rows[0].body)
    assert.equal(rows[0].link.url, '/staff/dev/qa?suite=kiosk&focus=problems')
    const again = await post('/api/qa/digest', token)
    assert.ok(again.status === 200 && again.json.already === true, 'a second call the same day sends nothing')
    assert.equal(live().db('schedule_notifications').length, before + rows.length, 'still one notification')
    live().db('qa_digests').length = 0
    runs.splice(runs.findIndex((r) => r.suite === 'kiosk'), 1)
    const missing = await post('/api/qa/digest?dry=1', token)
    assert.equal(missing.json.digest.status, 'fail', 'a report that did not arrive is a failure')
    assert.ok(missing.json.digest.body.includes('הקיוסק: הדוח לא הגיע'))
  })

  return stage
}
